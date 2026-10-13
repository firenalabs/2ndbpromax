import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from './arquivos.mjs';
import { listMaterials } from './materiais.mjs';
import { localDay } from './diario-registros.mjs';
import { validateDecision } from './contratos-diario.mjs';
import { terminalLog } from './terminal.mjs';

const identity = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const safe = s => String(s).normalize('NFC').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').slice(0, 65);
export class EditorialGeneration {
  constructor(root, config, { request = fetch, log = terminalLog, stop = () => false } = {}) { Object.assign(this, { root, config, request, log, stop }); }
  async initialize() {
    await mkdir(join(this.root, 'Conteúdos Gerados'), { recursive: true });
    this.path = join(this.root, 'sistema', 'geracoes.json');
    this.state = await readJson(this.path, { schemaVersion: 1, batches: [], units: {} });
    if (this.state.schemaVersion !== 1 || !this.state.units || !Array.isArray(this.state.batches)) throw new Error('Estado editorial incompatível.');
    for (const unit of Object.values(this.state.units)) if (unit.status === 'processing') unit.status = 'pending';
    await this.save();
  }
  async save() { await writeJson(this.path, this.state); }
  async call(payload) {
    if (!this.config.generationWebhook) throw new Error('Configure o webhook de geração de conteúdos.');
    const response = await this.request(this.config.generationWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(this.config.generationRequestTimeoutMs ?? 1800000) });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error?.message ?? `Geração respondeu HTTP ${response.status}.`);
    return result;
  }
  async legacyReferences() {
    const refs = new Set();
    const visit = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
        if (entry.isDirectory() && !entry.name.startsWith('gen-')) await visit(join(directory, entry.name));
        else if (entry.isFile() && entry.name.endsWith('.json')) { const c = await readJson(join(directory, entry.name), null); if (c?.referenceId) refs.add(c.referenceId); }
      }
    };
    await visit(join(this.root, 'Conteúdos Gerados')); return refs;
  }
  async runCuts() {
    const materials = await listMaterials(this.root), legacy = await this.legacyReferences();
    const selected = materials.flatMap(m => (m.blocks ?? []).map(block => ({ ...block, kind: 'recorte', sourceIds: [block.sourceId], digestIds: [m.id], inputFiles: [m.sourceFile ?? null] })));
    const pending = [];
    for (const source of selected) {
      const unit = this.state.units['recorte:' + source.id];
      if (unit?.status === 'completed' || unit?.status === 'legacy_review') continue;
      if (legacy.has(source.id) && !unit) { this.state.units['recorte:' + source.id] = { status: 'legacy_review', source, reason: 'Há conteúdo antigo; completude das novas saídas não comprovada. Revisar antes de regenerar.' }; continue; }
      pending.push(source);
    }
    await this.save();
    const old = this.state.batches.filter(b => b.kind === 'recortes' && b.status !== 'completed');
    for (const batch of old) { if (this.stop()) break; await this.executeBatch(batch); }
    const fresh = pending.filter(s => !this.state.units['recorte:' + s.id]);
    if (fresh.length && !this.stop()) await this.executeBatch(await this.createBatch('recortes', fresh));
    if (!old.length && !fresh.length) this.log('Nenhum recorte novo ou com geração pendente.');
    const reviews = Object.values(this.state.units).filter(u => u.status === 'legacy_review');
    if (reviews.length) {
      await writeFile(join(this.root, 'Conteúdos Gerados', 'Conteúdos antigos para revisão.md'), '# Conteúdos antigos para revisão\n\n' + reviews.map(u => `- ${u.source.id}: ${u.reason}`).join('\n') + '\n', 'utf8');
      this.log(`${reviews.length} recorte(s) com conteúdo antigo aguardam revisão. Veja Conteúdos Gerados/Conteúdos antigos para revisão.md.`, 'warning');
    }
  }
  async runDiary(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00Z')) || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day) throw new Error('Data inválida. Use AAAA-MM-DD.');
    const old = this.state.batches.find(b => b.kind === 'diario' && b.day === day && b.status !== 'completed');
    if (old) { await this.prepareGroups(old); await this.executeBatch(old); return; }
    const used = new Set(this.state.batches.filter(b => b.kind === 'diario').flatMap(b => b.records.map(r => r.sourceId)));
    const records = (await listMaterials(this.root)).filter(m => localDay(m.createdAt, this.config.timezone) === day && !used.has(m.sourceId))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.sourceId.localeCompare(b.sourceId));
    if (!records.length) { this.log('Nenhum registro novo desse dia para gerar.'); return; }
    const batch = await this.createBatch('diario', [], { day, records, groupingIndex: 1, groups: [[records[0]]], continuity: [] });
    await this.prepareGroups(batch); await this.executeBatch(batch);
  }
  async createBatch(kind, sources, extra = {}) {
    const now = new Date().toISOString(), id = randomUUID();
    const batch = { id, kind, createdAt: now, status: 'pending', folder: `gen-${now.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}-${kind}-${id.slice(0, 8)}`, sources, records: [], ...extra };
    this.state.batches.push(batch);
    await mkdir(join(this.root, 'Conteúdos Gerados', batch.folder, 'Fontes'), { recursive: true });
    await this.save(); await this.manifest(batch); return batch;
  }
  async prepareGroups(batch) {
    if (batch.sources.length) return;
    while (batch.groupingIndex < batch.records.length) {
      if (this.stop()) return;
      const i = batch.groupingIndex, first = batch.records[i - 1], second = batch.records[i];
      const result = await this.call({ operation: 'compare', first: { sourceId: first.sourceId, keytopics: first.keytopics }, second: { sourceId: second.sourceId, keytopics: second.keytopics }, threshold: this.config.continuityThreshold ?? 0.8 });
      const decision = validateDecision(result.decision, this.config.continuityThreshold ?? 0.8);
      batch.continuity.push({ firstSourceId: first.sourceId, secondSourceId: second.sourceId, ...decision });
      if (decision.accepted) batch.groups.at(-1).push(second); else batch.groups.push([second]);
      batch.groupingIndex++; await this.save(); await this.manifest(batch);
    }
    batch.sources = batch.groups.map(group => ({ id: 'group-' + identity(group.map(m => m.id).join(':')), kind: 'grupo',
      text: group.map(m => m.originalText).join('\n\n'), keytopic: group[0].keytopics[0].title, sourceIds: group.map(m => m.sourceId), digestIds: group.map(m => m.id), inputFiles: group.map(m => m.sourceFile ?? null),
      keytopics: group.flatMap(m => m.keytopics.map(t => ({ ...t, sourceId: m.sourceId }))), createdAt: group[0].createdAt,
      continuity: batch.continuity.filter(d => group.some(m => m.sourceId === d.firstSourceId) && group.some(m => m.sourceId === d.secondSourceId)) }));
    await this.save(); await this.manifest(batch);
  }
  async executeBatch(batch) {
    for (const [index, source] of batch.sources.entries()) {
      if (this.stop()) break;
      const key = source.kind + ':' + source.id;
      const unit = this.state.units[key] ??= { id: identity(key), source, batchId: batch.id, status: 'pending', cache: {}, files: [], errors: [] };
      if (unit.status === 'completed') continue;
      const code = (source.kind === 'recorte' ? 'R' : 'G') + String(index + 1).padStart(2, '0');
      unit.code = code; unit.status = 'processing'; await this.save(); await this.manifest(batch);
      try {
        if (source.text.length > (this.config.maxGroupCharacters ?? 120000)) throw new Error('Fonte acima do limite de caracteres configurado; texto integral conservado, sem truncamento.');
        const result = await this.call({ operation: 'generate', sourceKind: source.kind, source, cache: unit.cache, generationId: unit.id, generationBatchId: batch.id });
        if (!Array.isArray(result.posts) || !Array.isArray(result.errors) || !result.cache || typeof result.cache !== 'object') throw new Error('Resposta editorial incompleta; não marcar como concluída.');
        unit.cache = result.cache; unit.errors = result.errors;
        await this.save();
        for (const post of result.posts) await this.writePost(batch, unit, post, result);
        unit.status = unit.errors.length ? 'partial' : 'completed';
        unit.executionId = result.executionId; unit.workflowId = result.workflowId;
        await writeJson(join(this.root, 'Conteúdos Gerados', batch.folder, 'Fontes', code + '-execucao.json'), result);
      } catch (error) { unit.status = 'failed'; unit.errors = [{ message: error.message }]; }
      await this.save(); await this.manifest(batch); this.log(`${code}: ${unit.status}.`, unit.status==='completed'?'success':unit.status==='partial'?'warning':'error');
      for(const error of unit.errors??[])this.log(`Pendência de ${code}: ${error.message??String(error)}`, 'error');
    }
    batch.status = batch.sources.length && batch.sources.every(s => this.state.units[s.kind + ':' + s.id]?.status === 'completed') ? 'completed' : 'partial';
    await this.save(); await this.manifest(batch);
    this.log(`Resultados: Conteúdos Gerados/${batch.folder}`);
  }
  async writePost(batch, unit, post, execution) {
    if (!['LinkedIn', 'Twitter', 'Instagram', 'Blog'].includes(post.platform) || !post.contentKey || typeof post.body !== 'string' || !post.body.trim()) throw new Error('Post sem rede, identidade ou texto válido.');
    const id = identity(unit.id + ':' + post.contentKey), folder = join(this.root, 'Conteúdos Gerados', batch.folder, post.platform);
    await mkdir(folder, { recursive: true });
    const name = `${unit.code} - ${safe(post.contentType)} - ${safe(post.format)} - ${id.slice(0, 8)}`;
    const record = { ...post, id, source: { kind: unit.source.kind, id: unit.source.id, sourceIds: unit.source.sourceIds, digestIds: unit.source.digestIds }, generationId: unit.id,
      generationBatchId: batch.id, workflowId: execution.workflowId, executionId: execution.executionId, createdAt: batch.createdAt };
    await writeJson(join(folder, name + '.json'), record);
    const sourceLink = `../Fontes/${unit.code}.md`;
    await writeFile(join(folder, name + '.md'), `# ${post.title}\n\nRede: ${post.platform}\nFormato: ${post.format}\nTipo: ${post.contentType}\nFonte: [${unit.code}](${sourceLink})\nOriginais: ${unit.source.sourceIds.join(', ')}\nPedido: ${batch.id}\n${post.mediaPending ? '\nImagens/PDF ainda não produzidos.\n' : ''}\n${post.subtitle ?? ''}\n\n${post.body}${post.caption ? '\n\n## Legenda\n\n' + post.caption : ''}\n`, 'utf8');
    const relative = `${post.platform}/${name}.md`; if (!unit.files.includes(relative)) unit.files.push(relative);
    await this.save();
  }
  async manifest(batch) {
    const directory = join(this.root, 'Conteúdos Gerados', batch.folder);
    await writeJson(join(directory, 'pedido.json'), batch);
    const lines = [`# Pedido de geração — ${batch.kind}`, '', `Estado: ${batch.status}`, `Criado em: ${batch.createdAt}`, '', '## Fontes e resultados', ''];
    for (const [index, source] of batch.sources.entries()) {
      const code = (source.kind === 'recorte' ? 'R' : 'G') + String(index + 1).padStart(2, '0'), unit = this.state.units[source.kind + ':' + source.id];
      await writeJson(join(directory, 'Fontes', code + '.json'), source);
      await writeFile(join(directory, 'Fontes', code + '.md'), `# ${source.keytopic}\n\nTipo: ${source.kind}\nIdentidade: ${source.id}\n\n## Originais\n\n` + source.sourceIds.map((id,i) => `- [${id}](../../../${(source.inputFiles?.[i] ?? 'Recortes por Assunto/' + id).split('/').map(encodeURIComponent).join('/')})`).join('\n') + '\n\n## Texto utilizado\n\n' + source.text + '\n', 'utf8');
      lines.push(`### [${code} — ${source.keytopic}](Fontes/${code}.md)`, '', `Estado: ${unit?.status ?? 'pending'}`, '', ...(unit?.files ?? []).map(path => `- [${path}](${path.split('/').map(encodeURIComponent).join('/')})`), ...(unit?.errors ?? []).map(e => `- Pendência: ${e.message ?? e.erro?.message ?? JSON.stringify(e)}`), '');
      if (unit?.status === 'completed' && !unit.files.length) lines.push('Sem saídas previstas ou selecionadas para esta rota.', '');
    }
    await writeFile(join(directory, 'LEIA-ME.md'), lines.join('\n'), 'utf8');
  }
}
