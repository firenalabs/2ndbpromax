import { saveAutomaticContents } from './conteudos-automaticos.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, cp, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readJson, writeJson, readableName } from './arquivos.mjs';
import { buildBlocks, validateBlock, validateCategories } from './contratos-atlas.mjs';

import { validateZettelTree, nextNoteAddress, letterAddress, zettelFilename } from './zettelkasten.mjs';

export class AtlasProcessor {
  constructor(root, config, { request = fetch, log = console.log } = {}) {
    this.root = root;
    this.config = config;
    this.request = request;
    this.log = log;
    this.folder = join(root, 'Atlas');
    this.path = join(this.folder, 'atlas.json');
  }

  async initialize() {
    await mkdir(join(this.folder, 'Recortes'), { recursive: true });
    await mkdir(join(this.folder, 'Notas'), { recursive: true });
    const now = new Date().toISOString();
    this.atlas = await readJson(this.path, { id: randomUUID(), createdAt: now, updatedAt: now, schemaVersion: 2, categories: [], notes: [], noteIds: [] });
    if (this.atlas.schemaVersion === 1) await this.migrateLegacy();
    this.validateTree();
    await this.save();
    await this.render();
  }

  validateTree() {
    if (this.atlas.schemaVersion !== 2 || !Array.isArray(this.atlas.noteIds)) throw new Error('O registro do Atlas é incompatível.');
    validateZettelTree(this.atlas.categories, this.atlas.notes);
    if (new Set(this.atlas.noteIds).size !== this.atlas.noteIds.length || this.atlas.noteIds.length !== this.atlas.notes.length
      || this.atlas.notes.some(n => !this.atlas.noteIds.includes(n.id))) throw new Error('Referências de notas inconsistentes.');
    for (const c of this.atlas.categories) {
      const ids = this.atlas.notes.filter(n => n.categoryId === c.id).map(n => n.id);
      if (JSON.stringify(c.noteIds) !== JSON.stringify(ids)) throw new Error('Referências da categoria inconsistentes.');
    }
  }

  async migrateLegacy() {
    validateCategories(this.atlas.categories, 4);
    const old = this.atlas;
    if (!Array.isArray(old.noteIds) || new Set(old.noteIds).size !== old.noteIds.length) throw new Error('Referências antigas inválidas.');
    const roots = old.categories.filter(c => c.parentId === null).map((c, i) => ({ ...c, address: letterAddress(i + 1), schemaVersion: 2, noteIds: [] }));
    const notes = []; const blocks = [];
    for (const id of old.noteIds) {
      const block = await readJson(this.blockPath(id), null);
      if (!block || block.status !== 'accepted' || !block.title) throw new Error('Nota antiga não encontrada.');
      let category = old.categories.find(c => c.id === block.categoryId);
      if (!category) throw new Error('Categoria antiga da nota não encontrada.');
      while (category.parentId !== null) category = old.categories.find(c => c.id === category.parentId);
      const root = roots.find(c => c.id === category.id);
      const address = nextNoteAddress(roots, notes, root.id, null);
      const legacyNoteFile = readableName(block.title, block.createdAt, `${block.sourceId} — ${block.segmentId}`) + '.md';
      notes.push({ id, sourceId: block.sourceId, digestId: block.digestId, createdAt: block.createdAt, updatedAt: new Date().toISOString(),
        schemaVersion: 2, categoryId: root.id, parentNoteId: null, address, title: block.title, legacyNoteFile });
      root.noteIds.push(id);
      blocks.push({ ...block, categoryId: root.id, parentNoteId: null, address });
    }
    const converted = { ...old, schemaVersion: 2, categories: roots, notes };
    validateZettelTree(roots, notes);
    const backup = join(this.folder, 'Backup anterior ao Zettelkasten');
    let created = false;
    try { await mkdir(backup); created = true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (created) {
      for (const name of ['atlas.json', 'Recortes', 'Notas', 'Atlas de Conhecimento.md']) {
        await cp(join(this.folder, name), join(backup, name), { recursive: true }).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
      await writeFile(join(backup, 'README.md'), '# Cópia anterior ao Zettelkasten\n\nConserva a árvore, os recortes e as notas antes da conversão. Não participa do processamento.\n', 'utf8');
    }
    for (const block of blocks) await this.saveBlock(block);
    this.atlas = converted;
    await this.save();
    this.log(`Atlas convertido para endereços Zettelkasten: ${notes.length} nota(s).`);
  }

  async save() {
    this.validateTree();
    this.atlas.updatedAt = new Date().toISOString();
    await writeJson(this.path, this.atlas);
  }

  async call(payload) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.request(this.config.atlasWebhook, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.atlasRequestTimeoutMs ?? Math.max(this.config.requestTimeoutMs, 600000)),
        });
        let value;
        try { value = await response.json(); } catch { throw new Error('O workflow do Atlas não retornou JSON válido.'); }
        if (!response.ok || value?.ok !== true) {
          const message = value?.error?.message || `Falha no Atlas: HTTP ${response.status}.`;
          const legacy = message === 'Árvore ou profundidade de categorias inválida.';
          const error = new Error(legacy
            ? `O workflow do Atlas em ${new URL(this.config.atlasWebhook).origin} ainda usa a estrutura antiga. Atualize e publique o 02a nesse servidor ou escolha a opção 6 para usar o n8n atualizado. As digestões estão preservadas.`
            : message);
          error.retryable = !legacy && !(response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
          throw error;
        }
        return value;
      } catch (error) {
        lastError = error;
        if (error.retryable === false) throw error;
        if (attempt === 0) await sleep(500);
      }
    }
    throw lastError;
  }

  blockPath(id) { return join(this.folder, 'Recortes', `${id}.json`); }

  async saveBlock(block) {
    block.updatedAt = new Date().toISOString();
    await writeJson(this.blockPath(block.id), block);
  }

  async run(digest) {
    const expected = buildBlocks(digest);
    const existing = await Promise.all(expected.map(b => readJson(this.blockPath(b.id), null)));
    for (let i = 0; i < expected.length; i++) {
      if (!existing[i]) { existing[i] = expected[i]; await this.saveBlock(existing[i]); }
      validateBlock(existing[i], expected[i]);
    }
    const pending = existing.filter(b => !['accepted', 'filtered'].includes(b.status));
    let failures = [];
    if (pending.length) {
      const result = await this.call({ operation: 'process', digest, blocks: pending,
        atlasSchemaVersion: 2, categories: this.atlas.categories, notes: this.atlas.notes, knowledgeThreshold: this.config.knowledgeThreshold });
      if (!Array.isArray(result.blocks) || result.blocks.length !== pending.length || !Array.isArray(result.newCategories) || !Array.isArray(result.newNotes) || (result.errors !== undefined && !Array.isArray(result.errors))) throw new Error('O workflow não retornou todos os recortes e categorias.');
      const merged = [...this.atlas.categories];
      for (const category of result.newCategories) {
        if (merged.some(c => c.id === category.id)) throw new Error('O workflow tentou substituir uma categoria existente.');
        if (!Array.isArray(category.noteIds) || category.noteIds.length) throw new Error('Categoria nova com referências inválidas.');
        merged.push(category);
      }
      const mergedNotes = [...this.atlas.notes];
      for (const note of result.newNotes) {
        if (mergedNotes.some(n => n.id === note.id) || !pending.some(b => b.id === note.id && b.sourceId === note.sourceId && b.digestId === note.digestId) || note.schemaVersion !== 2 || note.noteFile !== undefined || note.legacyNoteFile !== undefined) throw new Error('Nota nova com identidade inválida.');
        mergedNotes.push(note);
      }
      validateZettelTree(merged, mergedNotes);
      for (let i = 0; i < pending.length; i++) {
        const block = validateBlock(result.blocks[i], pending[i]);
        if (['accepted', 'filtered', 'prepared'].includes(block.status)) {
          const k = block.knowledge;
          if (!Number.isFinite(k?.probability) || k.probability < 0 || k.probability > 1 || k.threshold !== this.config.knowledgeThreshold || k.accepted !== (k.probability >= k.threshold)) throw new Error('Decisão de conhecimento inválida.');
          if ((block.status === 'filtered') !== !k.accepted) throw new Error('Estado de recorte diverge do Jev.');
          if (block.status !== 'filtered' && (typeof block.title !== 'string' || !block.title.trim())) throw new Error('Título de nota inválido.');
        }
        const note = mergedNotes.find(n => n.id === block.id);
        if (block.status === 'accepted' && (!note || note.categoryId !== block.categoryId || note.parentNoteId !== block.parentNoteId || note.address !== block.address || note.title !== block.title || note.createdAt !== block.createdAt)) throw new Error('Posição ou título da nota diverge do recorte.');
        if (block.status !== 'accepted' && note) throw new Error('Nota pendente ou filtrada foi posicionada.');
        if (block.status !== 'accepted' && block.categoryId !== null) throw new Error('Recorte pendente ou filtrado com categoria inválida.');
      }
      this.atlas.categories = merged;
      this.atlas.notes = mergedNotes;
      this.atlas.noteIds = mergedNotes.map(n => n.id);
      for (const c of merged) c.noteIds = mergedNotes.filter(n => n.categoryId === c.id).map(n => n.id);
      await this.save();
      for (const block of result.blocks) {
        const index = existing.findIndex(b => b.id === block.id);
        existing[index] = block; await this.saveBlock(block);
      }
      await saveAutomaticContents(this.root, result, 'atlas', pending.map(b => ({ id:b.id, text:b.text, sourceIds:[b.sourceId], createdAt:b.createdAt })), this.log);
      failures = result.errors ?? [];
    }
    await this.render();
    const incomplete = existing.filter(b => !['accepted', 'filtered'].includes(b.status));
    if (incomplete.length) throw new Error(failures.find(e => e.blockId === incomplete[0].id)?.message || 'Há recortes pendentes no Atlas.');
    this.log(`Atlas atualizado: ${existing.length} recorte(s) de texto analisado(s).`);
  }

  async attach(block) {
    const note = this.atlas.notes.find(n => n.id === block.id);
    if (!note || note.categoryId !== block.categoryId || note.address !== block.address || note.parentNoteId !== block.parentNoteId) throw new Error('Posição da nota inconsistente.');
    const wordCount = (block.text.match(/\S+/gu) ?? []).length;
    const name = zettelFilename({ ...note, wordCount });
    await writeFile(join(this.folder, 'Notas', name), block.text, 'utf8');
    if (note.noteFile && note.noteFile !== name) await unlink(join(this.folder, 'Notas', note.noteFile)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (note.legacyNoteFile && note.legacyNoteFile !== name) await unlink(join(this.folder, 'Notas', note.legacyNoteFile)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (note.noteFile !== name || note.legacyNoteFile || note.wordCount !== wordCount) { note.wordCount = wordCount; note.noteFile = name; delete note.legacyNoteFile; await this.save(); }
  }

  async render() {
    this.validateTree();
    for (const note of this.atlas.notes) {
      const block = await readJson(this.blockPath(note.id), null);
      if (!block || block.status !== 'accepted' || block.title !== note.title) throw new Error('Nota referenciada não foi encontrada ou está inconsistente.');
      await this.attach(block);
    }
    const lines = [];
    const visit = (categoryId, parentNoteId) => {
      for (const note of this.atlas.notes.filter(n => n.categoryId === categoryId && n.parentNoteId === parentNoteId)) {
        lines.push(`${'#'.repeat(Math.min(6, note.address.split('.').length))} ${note.address} ${note.title}`, '');
        visit(categoryId, note.id);
      }
    };
    for (const category of this.atlas.categories) {
      lines.push(`# ${category.address}. ${category.name}`, '');
      visit(category.id, null);
    }
    await writeFile(join(this.folder, 'Atlas de Conhecimento.md'), lines.join('\n'), 'utf8');
  }
}
