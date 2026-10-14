import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from './arquivos.mjs';
import { listMaterials } from './materiais.mjs';
import { localDay } from './diario-registros.mjs';
import { validateDecision } from './contratos-diario.mjs';
import { terminalLog } from './terminal.mjs';
import {centralizePosts,normalizeCentralEditorial} from './conteudo-centralizado.mjs';

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
    await this.reorganizeSavedOutputs();
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
        if ((!Array.isArray(result.contents)&&!Array.isArray(result.posts)) || !Array.isArray(result.errors) || !result.cache || typeof result.cache !== 'object') throw new Error('Resposta editorial incompleta; não marcar como concluída.');
        unit.cache = result.cache; unit.errors = result.errors;
        await this.save();
        const previous=await readJson(join(this.root,'Conteúdos Gerados',batch.folder,'Fontes',code+'-execucao.json'),null);
        const getContents=value=>Array.isArray(value?.contents)?value.contents:value?.diagnostics?normalizeCentralEditorial(value.diagnostics).contents:centralizePosts(value?.posts??[]).contents;
        // Novas tentativas atualizam somente as saídas retornadas; conservam as anteriores.
        const merged=new Map(getContents(previous).map(c=>[c.contentKey,{...c,provenance:c.provenance??{workflowId:previous.workflowId,executionId:previous.executionId}}]));
        for(const c of getContents(result)) {
          const old=merged.get(c.contentKey),textSignature=value=>JSON.stringify([value?.parts,value?.title,value?.subtitle,value?.caption]);
          merged.set(c.contentKey,{...c,provenance:old&&textSignature(old)===textSignature(c)?old.provenance:{workflowId:result.workflowId,executionId:result.executionId}});
        }
        result.contents=[...merged.values()];
        await this.writeContents(batch,unit,result.contents,result);
        unit.status = unit.errors.length ? 'partial' : 'completed';
        unit.executionId = result.executionId; unit.workflowId = result.workflowId;
        await writeJson(join(this.root, 'Conteúdos Gerados', batch.folder, 'Fontes', code + '-execucao.json'), result);
      } catch (error) { unit.status = 'failed'; unit.errors = [{ message: error.message }]; }
      await this.save(); await this.manifest(batch); this.log(`${code}: ${unit.status}.`, unit.status==='completed'?'success':unit.status==='partial'?'warning':'error');
      for(const error of unit.errors??[])this.log(`Pendência de ${code}: ${error.message??error.erro?.message??JSON.stringify(error)}`, 'error');
    }
    batch.status = batch.sources.length && batch.sources.every(s => this.state.units[s.kind + ':' + s.id]?.status === 'completed') ? 'completed' : 'partial';
    await this.save(); await this.manifest(batch);
    this.log(`Resultados: Conteúdos Gerados/${batch.folder}`);
  }
  async reorganizeSavedOutputs() {
    for(const batch of this.state.batches)for(const source of batch.sources??[]) {
      const unit=this.state.units[source.kind+':'+source.id];
      if(!unit||unit.contentLayoutVersion===1||!unit.code)continue;
      const result=await readJson(join(this.root,'Conteúdos Gerados',batch.folder,'Fontes',unit.code+'-execucao.json'),null);
      if(!result)continue;
      const normalized=result.diagnostics?normalizeCentralEditorial(result.diagnostics):Array.isArray(result.contents)?result:centralizePosts(result.posts??[]);
      unit.layoutWarnings=normalized.warnings??[];
      await this.writeContents(batch,unit,normalized.contents,result);
      await this.manifest(batch);
    }
  }
  async writeContents(batch,unit,contents,execution) {
    const byType=new Map();
    for(const c of contents) {
      if(!/^[a-z][a-z0-9-]*$/.test(c.contentType)||!c.contentKey||!Array.isArray(c.parts)||!c.parts.length||c.parts.some(p=>typeof p!=='string'||!p.trim())||!Array.isArray(c.destinations)||c.destinations.some(d=>!['LinkedIn','Twitter','Instagram','Blog'].includes(d.platform)||typeof d.format!=='string'))throw new Error('Conteúdo-base inválido.');
      if(!byType.has(c.contentType))byType.set(c.contentType,[]);
      byType.get(c.contentType).push(c);
    }
    const directory=join(this.root,'Conteúdos Gerados',batch.folder);
    const unitFolder=unit.contentFolder??=unit.code+' — '+safe(unit.source.keytopic||unit.source.id);
    const folder=join(directory,unitFolder);await mkdir(folder,{recursive:true});
    const {text,keytopics,bulletpoints,...origin}=unit.source;
    await writeJson(join(folder,'origem.json'),{...origin,materialFile:'../Fontes/'+unit.code+'.json',generationId:unit.id,generationBatchId:batch.id});
    const oldFiles=[...unit.files],files=[];
    const index=['# '+unit.code+' — '+unit.source.keytopic,'','Fonte: [texto e composição](../Fontes/'+unit.code+'.md)','', '## Tipos de conteúdo',''];
    for(const[type,posts]of byType) {
      const typeFolder=join(folder,type);await mkdir(typeFolder,{recursive:true});
      const lines=['# '+type,'','Fonte: ['+unit.code+'](../../Fontes/'+unit.code+'.md)','','Texto-base integral. Redes e formatos são destinos previstos; limites de publicação não são aplicados nesta etapa.',''];
      const metadata=[];
      for(const[i,post]of posts.entries()) {
        const code='P'+String(i+1).padStart(2,'0'),id=identity(unit.id+':'+post.contentKey);
        lines.push('<a id="'+id+'"></a>','', '## '+code+' — '+post.title,'');
        if(post.variant)lines.push('Variação editorial: '+post.variant,'');
        if(post.legacyTextVariant)lines.push('Variante antiga com texto diferente por rede, preservada para revisão.','');
        if(post.subtitle)lines.push(post.subtitle,'');
        post.parts.forEach((part,partIndex)=>{if(post.parts.length>1)lines.push('### Bloco '+(partIndex+1),'');lines.push(part,'');if(partIndex<post.parts.length-1)lines.push('---','');});
        if(post.caption)lines.push('### Legenda-base','',post.caption,'');
        lines.push('***','');
        metadata.push({id,code,contentKey:post.contentKey,baseContentKey:post.baseContentKey??post.contentKey,variant:post.variant??null,
          contentFile:'conteudo.md#'+id,blockCount:post.parts.length,hasCaption:!!post.caption,characterCount:post.parts.join('\n\n').length,
          destinations:post.destinations,mediaPending:!!post.mediaPending,articleContentKey:post.articleContentKey??null,
          legacyTextVariant:!!post.legacyTextVariant,workflowId:post.provenance?.workflowId??execution.workflowId,executionId:post.provenance?.executionId??execution.executionId,lastCollectedExecutionId:execution.executionId});
      }
      await writeFile(join(typeFolder,'conteudo.md'),lines.join('\n'),'utf8');
      await writeJson(join(typeFolder,'metadados.json'),{schemaVersion:1,contentType:type,source:{kind:unit.source.kind,id:unit.source.id,sourceIds:unit.source.sourceIds,digestIds:unit.source.digestIds},originFile:'../origem.json',generationId:unit.id,generationBatchId:batch.id,createdAt:batch.createdAt,posts:metadata});
      const relative=unitFolder+'/'+type+'/conteudo.md';files.push(relative);
      index.push('- ['+type+' — '+posts.length+' post(s)]('+type+'/conteudo.md)');
    }
    await writeFile(join(folder,'índice.md'),index.join('\n')+'\n','utf8');
    unit.files=files;unit.contentLayoutVersion=1;await this.save();
    // Remove apenas arquivos antigos que o próprio estado e seus IDs comprovam.
    for(const path of oldFiles.filter(p=>/^(Twitter|LinkedIn|Instagram|Blog)\/[^/]+\.md$/.test(p))) {
      const jsonPath=path.replace(/\.md$/,'.json'),record=await readJson(join(directory,jsonPath),null);
      if(record?.generationId!==unit.id||record?.generationBatchId!==batch.id)continue;
      await unlink(join(directory,path)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await unlink(join(directory,jsonPath)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await rmdir(join(directory,path.split('/')[0])).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;});
    }
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
    await writeFile(join(directory, 'índice.md'), lines.join('\n'), 'utf8');
  }
}
