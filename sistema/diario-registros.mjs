import { mkdir, writeFile } from 'node:fs/promises';
import { terminalLog } from './terminal.mjs';
import { join } from 'node:path';
import { readJson, writeJson } from './arquivos.mjs';
import { validateDigest, segmentText } from './contratos.mjs';
import { validateSegmentSource } from './brag-segmentos.mjs';
import { validateAspects, validateDiaryOutput, validateBragOutput } from './contratos-diario.mjs';

export function localDay(date, timezone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date));
  const get = key => parts.find(p => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export class DiaryRecords {
  constructor(root, config, { request = fetch, log = terminalLog } = {}) {
    Object.assign(this, { root, config, request, log });
    this.path = join(root, 'sistema', 'diario-registros.json');
  }
  async initialize() {
    for (const path of ['Diário/Registros', 'Diário/Dias', 'Conquistas']) await mkdir(join(this.root, path), { recursive: true });
    this.state = await readJson(this.path, { schemaVersion: 1, records: [] });
    if (this.state.schemaVersion !== 1 || !Array.isArray(this.state.records)) throw new Error('Estado dos registros do Diário incompatível.');
    for (const record of this.state.records) if (record.status === 'processing') record.status = 'pending';
    const legacy = await readJson(join(this.root, 'sistema', 'diario.json'), null);
    for (const group of legacy?.groups ?? []) for (const input of group.inputs ?? []) {
      if (this.state.records.some(r => r.sourceId === input.sourceId)) continue;
      const record = { ...input, id: `${input.sourceId}-diary-input-v1`, day: localDay(input.createdAt, this.config.timezone),
        status: group.diaryStatus === 'completed' ? 'legacy' : 'pending', legacyGroupId: group.id, diary: null, aspects: null, achievements: null };
      this.state.records.push(record); await this.writeRecord(record);
    }
    await this.save();
  }
  async save() { await writeJson(this.path, this.state); }
  async accept(digest, inputName) {
    validateDigest(digest, { id: digest.sourceId, digestId: digest.id, text: digest.originalText });
    if (this.state.records.some(r => r.sourceId === digest.sourceId)) return;
    const record = { id: `${digest.sourceId}-diary-input-v1`, sourceId: digest.sourceId, digestId: digest.id,
      createdAt: digest.createdAt, day: localDay(digest.createdAt, this.config.timezone), inputName,
      text: digest.originalText, keytopics: digest.keytopics, segmentedText:digest.segmentedText, segmentation:digest.segmentation,
      segmentationSource:'keytopics', status: 'pending', diary: null, aspects: null, achievements: null };
    this.state.records.push(record);
    await this.writeRecord(record);
    await this.save();
  }
  async prepareSegments(record) {
    if(record.segmentation===undefined && record.segmentedText===undefined) {
      const state=await readJson(join(this.root,'sistema','estado.json'),{jobs:[]});
      const job=state.jobs.find(j=>j.id===record.sourceId);
      const path=job?.baseName ? join(this.root,'KeyTopics Processados',job.baseName+'.json') : null;
      const digest=path ? await readJson(path,null) : null;
      if(digest) {
        validateDigest(digest,{id:record.sourceId,digestId:record.digestId??digest.id,text:record.text});
        record.segmentedText=digest.segmentedText;record.segmentation=digest.segmentation;record.digestId=digest.id;
        record.segmentationSource='keytopics';
      } else {
        record.segmentation=segmentText(record.text);
        record.segmentedText=record.segmentation.segments.map(s=>'['+s.id+'] '+record.text.slice(s.start,s.end).trim()).join('\n');
        record.segmentationSource='deterministic-fallback';
        this.log(`Diário: mapa salvo indisponível para ${record.inputName}; segmentação reconstruída deterministicamente, sem IA.`, 'warning');
      }
    }
    validateSegmentSource(record.text,record.segmentedText,record.segmentation);
  }
  async finalizePending({ retry = false } = {}) {
    for (const record of this.state.records) {
      if (retry && ['failed', 'partial'].includes(record.status)) record.status = 'pending';
      if (record.status !== 'pending') continue;
      record.status = 'processing'; await this.save();
      try {
        await this.prepareSegments(record);
        const payload = { operation: 'finalize', text: record.text, segmentedText:record.segmentedText, segmentation:record.segmentation,
          sourceId:record.sourceId,digestId:record.digestId, groupId: record.id, sourceIds: [record.sourceId], threshold: this.config.aspectThreshold };
        const response = await this.request(this.config.diaryWebhook, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(this.config.diaryRequestTimeoutMs ?? 600000) });
        const result = await response.json();
        if (!response.ok || result.ok === false) throw new Error(result.error?.message ?? `Diário respondeu HTTP ${response.status}.`);
        record.aspects = validateAspects(result.aspects, this.config.aspectThreshold);
        if (result.diary && !record.diary) record.diary = validateDiaryOutput(result.diary);
        if(record.aspects.flags.victory && Array.isArray(result.achievements)) {
          const incoming=validateBragOutput(result,record.text,record.segmentation);
          const key=a=>JSON.stringify([a.evento,a.categoria,a.integra]);
          const preserved=new Map((record.achievements??[]).map(a=>[key(a),a]));
          for(const item of incoming)preserved.set(key(item),item);
          record.achievements=[...preserved.values()];
        } else if(!result.errors?.brag)record.achievements=record.aspects.flags.victory?validateBragOutput(result,record.text,record.segmentation):[];
        record.bragWarnings=result.bragWarnings??[];
        record.rejectedAchievements=result.rejectedAchievements??[];
        record.errors = result.errors ?? {};
        if (!record.diary) record.errors.diary ??= 'Escrivão não retornou um registro válido.';
        record.status = Object.keys(record.errors).length ? 'partial' : 'completed';
      } catch (error) { record.status = 'failed'; record.errors = { pipeline: error.message }; }
      record.updatedAt = new Date().toISOString();
      await this.writeRecord(record); await this.save();
      const labels={completed:'concluído',partial:'parcial',failed:'falhou'};
      this.log(`Diário: ${record.inputName} — ${labels[record.status]??record.status}.`,record.status==='completed'?'success':record.status==='partial'?'warning':'error');
      for(const warning of record.bragWarnings??[])this.log(`Aviso de ${record.inputName} (brag): ${warning.message}`, 'warning');
      for(const[stage,message]of Object.entries(record.errors??{}))this.log(`Pendência de ${record.inputName} (${stage}): ${message}`, 'error');
    }
  }
  async writeRecord(record) {
    const base = `${record.day} - ${record.sourceId}`;
    await writeJson(join(this.root, 'Diário', 'Registros', base + '.json'), record);
    await writeFile(join(this.root, 'Diário', 'Registros', base + '.md'),
      [`# ${record.diary?.title ?? record.inputName}`, '', `Estado: ${record.status}`, `Origem: ${record.sourceId}`, '',
        record.diary?.summary ?? 'Registro recebido. Elaboração ainda não concluída.', '', '## Texto original', '', record.text,
        '', '## Avisos', '', ...(record.bragWarnings??[]).map(w=>'- '+w.message),
        '', '## Pendências', '', ...Object.entries(record.errors ?? {}).map(([k, v]) => `- ${k}: ${v}`), ''].join('\n'), 'utf8');
    for (const [i, achievement] of (record.achievements ?? []).entries()) {
      const name = `${base}-achievement-${i + 1}`;
      await writeJson(join(this.root, 'Conquistas', name + '.json'), { ...achievement, id: name, sourceIds: [record.sourceId], recordId: record.id });
      const reference=achievement.segmentoInicial ? `\nSegmentos: ${achievement.segmentoInicial} até ${achievement.segmentoFinal} (inclusive)\nPosições UTF-16: ${achievement.start} até ${achievement.end} (fim exclusivo)\n` : '';
      await writeFile(join(this.root, 'Conquistas', name + '.md'), `# ${achievement.evento}\n\n${achievement.descricao}\n\nOrigem: ${record.sourceId}\n${reference}\n## Trecho literal\n\n${achievement.integra}\n`, 'utf8');
    }
    const records = this.state.records.filter(r => r.day === record.day);
    await writeFile(join(this.root, 'Diário', 'Dias', record.day + '.md'), '# Registros de ' + record.day + '\n\n' + records.map(r =>
      `- [${r.diary?.title ?? r.inputName}](../Registros/${r.day}%20-%20${r.sourceId}.md) — ${r.status}`).join('\n') + '\n', 'utf8');
  }
}
