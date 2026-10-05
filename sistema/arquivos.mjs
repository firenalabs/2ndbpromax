import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const folders = {
  input: 'Entrada', originals: 'Originais', processed: 'Processados',
  digests: 'Digestões', atlas: 'Atlas', diary: 'Diário', achievements: 'Conquistas', errors: 'Erros', generatedContents: 'Conteúdos Gerados',
};

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function writeJson(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}

export async function ensureFolders(root) {
  await mkdir(join(root, 'sistema'), { recursive: true });
  for (const folder of Object.values(folders)) await mkdir(join(root, folder), { recursive: true });
}

export function readableName(filename, date, id) {
  const rawName = filename.replace(/\.txt$/i, '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-');
  let name = '';
  for (const character of rawName) {
    if (name.length >= 80 || Buffer.byteLength(name + character, 'utf8') > 140) break;
    name += character;
  }
  name ||= 'texto';
  return `${date.slice(0, 10)} — ${name} — ${id}`;
}

export function digestMarkdown(digest, filename) {
  const lines = [
    `# Digestão de ${filename}`, '',
    `Origem: ${digest.sourceId}`, `Criado em: ${digest.createdAt}`, '',
    '## Tópicos e ideias principais', '',
  ];
  for (const topic of digest.keytopics) {
    lines.push(`### ${topic.title}`, '', `Início: ${topic.id}`, '');
    for (const point of topic.bulletpoints) lines.push(`- ${point}`);
    lines.push('');
  }
  lines.push('## Texto original', '', digest.originalText, '', '## Texto com segmentos', '', digest.segmentedText, '');
  return lines.join('\n');
}
