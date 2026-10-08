import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJson, readableName } from './arquivos.mjs';

// Also embedded verbatim in n8n Code nodes. No JSON parser or second LLM.
export function structureAutomaticContent(value, context, origin) {
  if (value.error) return { generatedContents: [], generatedContentErrors: [{ origin, referenceId: context.referenceId, message: String(value.error.message ?? value.error) }] };
  if (value.output === undefined) return { generatedContents: [], generatedContentErrors: [] }; // Switch fallback: continue normally.
  const body = typeof value.output === 'string' ? value.output.trim() : JSON.stringify(value.output, null, 2);
  if (!body) return { generatedContents: [], generatedContentErrors: [{ origin, referenceId: context.referenceId, message: 'Agent retornou conteúdo vazio.' }] };
  const now = new Date().toISOString();
  const title = (body.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? context.contentTitle ?? 'Conteúdo gerado').slice(0, 150).trim();
  return { generatedContents: [{ schemaVersion: 1, origin, referenceId: context.referenceId, sourceIds: context.contentSourceIds,
    createdAt: now, updatedAt: now, title, body, sourceWordCount: context.sourceWordCount,
    wordCount: (body.match(/\S+/g) ?? []).length }], generatedContentErrors: [] };
}

export async function saveAutomaticContents(root, result, origin, sources, log = console.log) {
  const directory = join(root, 'Conteúdos Gerados');
  // Content errors never change the status of Atlas/Diário.
  for (const error of Array.isArray(result.generatedContentErrors) ? result.generatedContentErrors : []) log(`Conteúdo ${origin} pendente: ${error.message}`);
  for (const content of Array.isArray(result.generatedContents) ? result.generatedContents : []) {
    try {
      const source = sources.find(s => s.id === content.referenceId);
      if (!source || content.origin !== origin || typeof content.body !== 'string' || !content.body.trim()
        || typeof content.title !== 'string' || !content.title.trim()) throw new Error('Conteúdo automático inválido ou sem origem correspondente.');
      const contentKey = typeof content.contentKey === 'string' && content.contentKey.trim()
        ? content.contentKey.trim() : null;
      const id = createHash('sha256').update(`${origin}:${source.id}${contentKey ? ':' + contentKey : ''}`).digest('hex').slice(0, 24);
      const record = { ...content, id, schemaVersion: 1, sourceIds: source.sourceIds,
        sourceWordCount: (source.text.match(/\S+/g) ?? []).length, wordCount: (content.body.match(/\S+/g) ?? []).length };
      if (!Number.isFinite(Date.parse(record.createdAt))) record.createdAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      // Stable filenames avoid duplicates when an execution is retried.
      const name = readableName(origin === 'atlas' ? 'Atlas' : 'Diário', source.createdAt ?? record.createdAt, id);
      await mkdir(directory, { recursive: true });
      await writeJson(join(directory, name + '.json'), record);
      await writeFile(join(directory, name + '.md'), record.body + '\n', 'utf8');
      log(`Conteúdo ${origin} salvo: ${record.title}`);
    } catch (error) { log(`Não foi possível salvar conteúdo ${origin}: ${error.message}`); }
  }
}
