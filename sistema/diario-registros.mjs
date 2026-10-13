import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from './arquivos.mjs';
import { validateDigest } from './contratos.mjs';
import { validateAspects, validateDiaryOutput, validateBragOutput } from './contratos-diario.mjs';

export function localDay(date, timezone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date));
  const get = key => parts.find(p => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export class DiaryRecords {
  constructor(root, config, { request = fetch, log = console.log } = {}) {
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
      text: digest.originalText, keytopics: digest.keytopics, status: 'pending', diary: null, aspects: null, achievements: null };
    this.state.records.push(record);
    await this.writeRecord(record);
    await this.save();
  }
  async finalizePending({ retry = false } = {}) {
    for (const record of this.state.records) {
      if (retry && ['failed', 'partial'].includes(record.status)) record.status = 'pending';
      if (record.status !== 'pending') continue;
      record.status = 'processing'; await this.save();
      try {
        const payload = { operation: 'finalize', text: record.text, groupId: record.id, sourceIds: [record.sourceId], threshold: this.config.aspectThreshold };
        const response = await this.request(this.config.diaryWebhook, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(this.config.diaryRequestTimeoutMs ?? 600000) });
        const result = await response.json();
        if (!response.ok || result.ok === false) throw new Error(result.error?.message ?? `Diário respondeu HTTP ${response.status}.`);
        record.aspects = validateAspects(result.aspects, this.config.aspectThreshold);
        if (result.diary && !record.diary) record.diary = validateDiaryOutput(result.diary);
        if (!result.errors?.brag) record.achievements = record.aspects.flags.victory ? validateBragOutput(result, record.text) : [];
        record.errors = result.errors ?? {};
        if (!record.diary) record.errors.diary ??= 'Escrivão não retornou um registro válido.';
        record.status = Object.keys(record.errors).length ? 'partial' : 'completed';
      } catch (error) { record.status = 'failed'; record.errors = { pipeline: error.message }; }
      record.updatedAt = new Date().toISOString();
      await this.writeRecord(record); await this.save();
      this.log(`Diário: ${record.inputName} — ${record.status}.`);
    }
  }
  async writeRecord(record) {
    const base = `${record.day} - ${record.sourceId}`;
    await writeJson(join(this.root, 'Diário', 'Registros', base + '.json'), record);
    await writeFile(join(this.root, 'Diário', 'Registros', base + '.md'),
      [`# ${record.diary?.title ?? record.inputName}`, '', `Estado: ${record.status}`, `Origem: ${record.sourceId}`, '',
        record.diary?.summary ?? 'Registro recebido. Elaboração ainda não concluída.', '', '## Texto original', '', record.text,
        '', '## Pendências', '', ...Object.entries(record.errors ?? {}).map(([k, v]) => `- ${k}: ${v}`), ''].join('\n'), 'utf8');
    for (const [i, achievement] of (record.achievements ?? []).entries()) {
      const name = `${base}-achievement-${i + 1}`;
      await writeJson(join(this.root, 'Conquistas', name + '.json'), { ...achievement, id: name, sourceIds: [record.sourceId], recordId: record.id });
      await writeFile(join(this.root, 'Conquistas', name + '.md'), `# ${achievement.evento}\n\n${achievement.descricao}\n\nOrigem: ${record.sourceId}\n\n## Trecho literal\n\n${achievement.integra}\n`, 'utf8');
    }
    const records = this.state.records.filter(r => r.day === record.day);
    await writeFile(join(this.root, 'Diário', 'Dias', record.day + '.md'), '# Registros de ' + record.day + '\n\n' + records.map(r =>
      `- [${r.diary?.title ?? r.inputName}](../Registros/${r.day}%20-%20${r.sourceId}.md) — ${r.status}`).join('\n') + '\n', 'utf8');
  }
}
