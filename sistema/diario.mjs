import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readJson, writeJson, readableName } from './arquivos.mjs';
import { validateDigest } from './contratos.mjs';
import { aspectKeys, aspectLabels, validateDecision, validateAspects, validateDiaryOutput, validateBragOutput } from './contratos-diario.mjs';
import { contentRange, validateGeneratedContent, contentWebhookFor } from './conteudos.mjs';

export class DiaryProcessor {
  constructor(root, config, { request = fetch, log = console.log } = {}) {
    this.root = root; this.config = config; this.request = request; this.log = log;
    this.statePath = join(root, 'sistema', 'diario.json');
  }

  async initialize() {
    for (const folder of ['sistema', 'Diário/Grupos', 'Conquistas', 'Erros', 'Conteúdos Gerados']) await mkdir(join(this.root, folder), { recursive: true });
    const now = new Date().toISOString();
    this.state = await readJson(this.statePath, { id: randomUUID(), createdAt: now, updatedAt: now, schemaVersion: 1, openGroupId: null, groups: [] });
    this.validateState();
    for (const group of this.state.groups) {
      group.contentStatus ??= group.status === 'open' || group.diaryStatus !== 'completed' || !['completed', 'skipped'].includes(group.bragStatus) ? 'pending' : 'skipped';
    }
    await writeFile(join(this.root, 'Conteúdos Gerados', 'README.md'), '# Conteúdos Gerados\n\nTextos gerados pelos Agents do 03 Conteúdos Gerados. Use a opção 8 do iniciador para gerar conteúdos dos grupos concluídos; o processamento normal não chama esse fluxo.\n\nAbra os arquivos .md para ler. Os .json guardam o conteúdo, IDs, datas, referências das origens e contagem de palavras. Textos com até 150 palavras não geram conteúdo nesta etapa.\n', { encoding: 'utf8', flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await this.save();
  }

  validateState() {
    if (this.state.schemaVersion !== 1 || !Array.isArray(this.state.groups)) throw new Error('Estado do Diário incompatível. Conserve sistema/diario.json.');
    const ids = new Set(); const sources = new Set();
    for (const group of this.state.groups) {
      if (!group.id || ids.has(group.id) || !['open', 'closed'].includes(group.status) || !Array.isArray(group.inputs) || !group.inputs.length) throw new Error('Grupo do Diário inválido.');
      ids.add(group.id);
      for (const input of group.inputs) {
        if (!input.sourceId || sources.has(input.sourceId) || typeof input.text !== 'string' || !input.text.trim() || !Array.isArray(input.keytopics)) throw new Error('Origem duplicada ou inválida no Diário.');
        sources.add(input.sourceId);
      }
      if (JSON.stringify(group.sourceIds) !== JSON.stringify(group.inputs.map(i => i.sourceId)) || group.lastSourceId !== group.sourceIds.at(-1)
        || group.fullText !== group.inputs.map(i => i.text).join('\n\n')) throw new Error('O grupo diverge dos textos originais.');
    }
    const open = this.state.groups.filter(g => g.status === 'open');
    if (open.length > 1 || (open[0]?.id ?? null) !== this.state.openGroupId) throw new Error('Janela aberta do Diário inconsistente.');
  }

  groupName(group) { return readableName('Grupo de textos', group.createdAt, group.id); }

  async save() {
    this.validateState();
    this.state.updatedAt = new Date().toISOString();
    await writeJson(this.statePath, this.state);
    for (const group of this.state.groups) {
      const name = this.groupName(group);
      await writeJson(join(this.root, 'Diário', 'Grupos', name + '.json'), group);
      await writeFile(join(this.root, 'Diário', 'Grupos', name + '.md'), this.groupMarkdown(group), 'utf8');
    }
    const open = this.state.groups.find(g => g.id === this.state.openGroupId);
    await writeFile(join(this.root, 'Diário', 'Grupo em andamento.md'), open ? this.groupMarkdown(open)
      : '# Grupo em andamento\n\nAinda não há textos agrupados. Coloque arquivos na Entrada e inicie o sistema.\n', 'utf8');
  }

  groupMarkdown(group) {
    const lines = ['# Grupo de textos', '', group.status === 'open' ? '**Aguardando o próximo texto.** Este grupo só será concluído quando o Jev identificar quebra de continuidade.' : '**Grupo concluído por quebra de continuidade.**', '',
      `Identidade: ${group.id}`, `Textos: ${group.inputs.length}`, '', '## Textos originais', ''];
    for (const input of group.inputs) lines.push(`### ${input.inputName}`, '', `Origem: ${input.sourceId}`, '', input.text, '');
    return lines.join('\n');
  }

  async call(payload, webhook = this.config.diaryWebhook) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.request(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(this.config.diaryRequestTimeoutMs ?? Math.max(this.config.requestTimeoutMs, 600000)) });
        let value;
        try { value = await response.json(); } catch { throw new Error('O workflow do Diário não retornou JSON válido.'); }
        if (!response.ok || value?.ok !== true) throw new Error(value?.error?.message || `Falha no workflow: HTTP ${response.status}.`);
        return value;
      } catch (error) { lastError = error; if (attempt === 0) await sleep(500); }
    }
    throw lastError;
  }

  createGroup(input) {
    const now = new Date().toISOString();
    const group = { id: `${input.sourceId}-group-v1`, createdAt: input.createdAt, updatedAt: now, schemaVersion: 1,
      status: 'open', sourceIds: [input.sourceId], lastSourceId: input.sourceId, inputs: [input], fullText: input.text,
      continuityDecisions: [], aspects: null, diaryStatus: 'pending', bragStatus: 'pending', contentStatus: 'pending' };
    this.state.groups.push(group); this.state.openGroupId = group.id;
    return group;
  }

  async accept(digest, inputName) {
    validateDigest(digest, { id: digest.sourceId, digestId: digest.id, text: digest.originalText });
    if (this.state.groups.some(g => g.sourceIds.includes(digest.sourceId))) return;
    const input = { sourceId: digest.sourceId, digestId: digest.id, createdAt: digest.createdAt, inputName, text: digest.originalText, keytopics: digest.keytopics };
    const group = this.state.groups.find(g => g.id === this.state.openGroupId);
    if (!group) this.createGroup(input);
    else {
      const last = group.inputs.at(-1);
      const response = await this.call({ operation: 'compare', first: { sourceId: last.sourceId, keytopics: last.keytopics }, second: { sourceId: input.sourceId, keytopics: input.keytopics }, threshold: this.config.continuityThreshold });
      const decision = validateDecision(response.decision, this.config.continuityThreshold);
      group.continuityDecisions.push({ firstSourceId: last.sourceId, secondSourceId: input.sourceId, ...decision });
      if (decision.accepted) {
        group.inputs.push(input); group.sourceIds.push(input.sourceId); group.lastSourceId = input.sourceId;
        group.fullText += '\n\n' + input.text;
      } else {
        group.status = 'closed'; group.closedAt = new Date().toISOString(); group.closedBySourceId = input.sourceId;
        this.createGroup(input);
      }
      group.updatedAt = new Date().toISOString();
    }
    await this.save();
    this.log('Grupo do Diário aguardando próximo texto.');
  }

  errorPath(group, stage) { return join(this.root, 'Erros', `${stage} — ${this.groupName(group)}.md`); }

  async stageError(group, stage, error) {
    await writeFile(this.errorPath(group, stage), `# ${stage} pendente\n\n${error.message}\n\nOs textos do grupo ${group.id} ficaram salvos em Diário/Grupos. Use “Tentar novamente” no iniciador. O grupo em andamento e os demais inputs podem continuar.\n`, 'utf8');
    this.log(`${stage} pendente: ${error.message}. Textos conservados.`);
  }

  async clearError(group, stage) { await unlink(this.errorPath(group, stage)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }

  async finalizePending({ retry = false, generateContent = false, contentOnly = false } = {}) {
    for (const group of this.state.groups.filter(g => g.status === 'closed')) {
      if (!contentOnly && retry && group.diaryStatus === 'failed') group.diaryStatus = 'pending';
      if (!contentOnly && retry && group.bragStatus === 'failed') group.bragStatus = 'pending';
      if (generateContent && retry && group.contentStatus === 'failed') group.contentStatus = 'pending';
      if (group.diaryStatus !== 'pending' && !(group.diaryStatus === 'completed' && group.bragStatus === 'pending') && !(generateContent && group.contentStatus === 'pending')) continue;
      if (group.achievements && group.aspects?.flags.victory) group.actionsCompleted = true;
      const payload = { operation: 'finalize', text: group.fullText, threshold: this.config.aspectThreshold, groupId: group.id, sourceIds: group.sourceIds };
      const contentRequest = generateContent && group.contentStatus === 'pending' && !group.generatedContent && contentRange(group.fullText)
        ? (group.fullText.length > this.config.maxGroupCharacters
          ? Promise.resolve({ error: new Error('O grupo excede o limite de caracteres para gerar conteúdo; o texto foi conservado.') })
          : this.call(payload, contentWebhookFor(this.config)).then(result => ({ result }), error => ({ error })))
        : Promise.resolve({});
      let errors = {};
      if (!contentOnly && (group.diaryStatus === 'pending' || group.bragStatus === 'pending') && (!group.aspects || !group.diaryOutput || !group.actionsCompleted)) {
        try {
          if (group.fullText.length > this.config.maxGroupCharacters) throw new Error(`O grupo excede o limite de ${this.config.maxGroupCharacters} caracteres do protótipo. Seus textos completos foram conservados em Diário/Grupos; nenhum trecho foi truncado.`);
          const result = await this.call(payload);
          errors = result.errors ?? {};
          group.aspects = validateAspects(result.aspects, this.config.aspectThreshold);
          if (result.diary && !group.diaryOutput) group.diaryOutput = validateDiaryOutput(result.diary);
          if (!errors.brag) {
            if (group.aspects.flags.victory && !group.achievements) group.achievements = validateBragOutput(result, group.fullText);
            group.actionsCompleted = true;
          }
          await this.save();
        } catch (error) { errors.pipeline = error.message; }
      }
      if (!contentOnly && group.diaryStatus === 'pending') {
        try {
          if (!group.aspects || !group.diaryOutput) throw new Error(errors.pipeline || errors.diary || 'O workflow não retornou um Diário válido.');
          await this.writeDiary(group); await this.clearError(group, 'Diário');
          group.diaryStatus = 'completed'; delete group.diaryError;
          this.log(`Diário salvo: ${group.diaryOutput.title}`);
        } catch (error) { group.diaryStatus = 'failed'; group.diaryError = error.message; await this.stageError(group, 'Diário', error); }
        group.updatedAt = new Date().toISOString(); await this.save();
      }
      if (!contentOnly && group.diaryStatus === 'completed' && group.bragStatus === 'pending') {
        try {
          if (!group.actionsCompleted) throw new Error(errors.pipeline || errors.brag || 'A execução das ações ficou pendente.');
          if (!group.aspects.flags.victory) group.bragStatus = 'skipped';
          else {
            await this.writeAchievements(group);
            group.bragStatus = 'completed';
            group.bragDivergence = group.achievements.length === 0 ? 'Jev identificou vitória, mas o Agent não extraiu uma conquista factual.' : null;
          }
          delete group.bragError; await this.clearError(group, 'Conquistas'); await this.writeDiary(group);
        } catch (error) { group.bragStatus = 'failed'; group.bragError = error.message; await this.stageError(group, 'Conquistas', error); }
        if (group.bragStatus === 'failed') await this.writeDiary(group);
        group.updatedAt = new Date().toISOString(); await this.save();
      }
      const contentResponse = await contentRequest;
      if (generateContent && group.contentStatus === 'pending') {
        try {
          if (!contentRange(group.fullText)) group.contentStatus = 'skipped';
          else {
            if (!group.generatedContent) {
              if (contentResponse.error) throw contentResponse.error;
              const result = contentResponse.result;
              if (!result?.generatedContent) throw new Error(result?.errors?.generatedContent || 'Atualize e publique o workflow 03 Conteúdos Gerados nesse n8n.');
              group.generatedContent = validateGeneratedContent(result.generatedContent, group.fullText);
              await this.save();
            }
            await this.writeGeneratedContent(group);
            group.contentStatus = 'completed';
            this.log(`Conteúdo salvo: ${group.generatedContent.title}`);
          }
          delete group.contentError; await this.clearError(group, 'Conteúdo');
        } catch (error) { group.contentStatus = 'failed'; group.contentError = error.message; await this.stageError(group, 'Conteúdo', error); }
        group.updatedAt = new Date().toISOString(); await this.save();
      }
    }
  }

  async generatePendingContents() {
    for (const group of this.state.groups.filter(g => g.status === 'closed')) {
      if (group.contentStatus === 'skipped' && contentRange(group.fullText)) group.contentStatus = 'pending';
    }
    await this.save();
    await this.finalizePending({ retry: true, generateContent: true, contentOnly: true });
  }

  async writeDiary(group) {
    const now = new Date().toISOString();
    const id = `${group.id}-diary-v1`;
    const name = readableName(group.diaryOutput.title, group.createdAt, id);
    const achievementIds = group.bragStatus === 'completed' ? (group.achievements ?? []).map((_, i) => `${group.id}-achievement-${i + 1}`) : [];
    const record = { id, createdAt: group.closedAt, updatedAt: now, schemaVersion: 1, groupId: group.id, sourceIds: group.sourceIds,
      ...group.diaryOutput, flags: group.aspects.flags, tags: aspectKeys.filter(k => group.aspects.flags[k]).map(k => aspectLabels[k]),
      aspectDecisions: group.aspects.decisions, keytopicsBySource: group.inputs.map(({ sourceId, digestId, keytopics }) => ({ sourceId, digestId, keytopics })),
      achievementIds, bragStatus: group.bragStatus, bragDivergence: group.bragDivergence ?? null,
      processing: { promptVersion: 'diary-codex-v1', model: this.config.model } };
    await writeJson(join(this.root, 'Diário', name + '.json'), record);
    const bragLabels = { pending: 'Aguardando extração', completed: 'Extração concluída', skipped: 'Nenhuma vitória identificada', failed: 'Pendente; consulte a pasta Erros' };
    const lines = [`# ${record.title}`, '', record.summary, '', `Aspectos: ${record.tags.join(', ') || 'Nenhum identificado'}`, `Grupo: ${group.id}`, `Conquistas: ${bragLabels[group.bragStatus]}`, '', '## Assuntos por texto', ''];
    for (const input of group.inputs) {
      lines.push(`### ${input.inputName}`, '', `Origem: ${input.sourceId}`, '');
      for (const topic of input.keytopics) lines.push(`#### ${topic.title}`, '', `Segmento: ${topic.id}`, '', ...topic.bulletpoints.map(b => '- ' + b), '');
    }
    if (group.bragDivergence) lines.push(group.bragDivergence, '');
    lines.push('## Texto completo do grupo', '', group.fullText, '');
    await writeFile(join(this.root, 'Diário', name + '.md'), lines.join('\n'), 'utf8');
    group.diaryFile = join('Diário', name + '.json');
  }

  async writeGeneratedContent(group) {
    const content = validateGeneratedContent(group.generatedContent, group.fullText);
    const id = `${group.id}-content-v1`, name = readableName(content.title, group.createdAt, id);
    const record = { ...content, id, createdAt: group.closedAt, updatedAt: new Date().toISOString(), groupId: group.id, sourceIds: [...group.sourceIds] };
    await writeJson(join(this.root, 'Conteúdos Gerados', name + '.json'), record);
    await writeFile(join(this.root, 'Conteúdos Gerados', name + '.md'), `# ${content.title}\n\n${content.body}\n`, 'utf8');
    group.contentFile = join('Conteúdos Gerados', name + '.json');
  }

  async writeAchievements(group) {
    for (let i = 0; i < group.achievements.length; i++) {
      const achievement = group.achievements[i]; const id = `${group.id}-achievement-${i + 1}`;
      const record = { id, createdAt: group.closedAt, updatedAt: new Date().toISOString(), schemaVersion: 1, groupId: group.id, sourceIds: group.sourceIds,
        ...achievement, processing: { promptVersion: 'brag-codex-v1', model: this.config.model } };
      const name = readableName(achievement.evento, group.createdAt, id);
      await writeJson(join(this.root, 'Conquistas', name + '.json'), record);
      await writeFile(join(this.root, 'Conquistas', name + '.md'), [`# ${record.evento}`, '', record.descricao, '', `Categoria: ${record.categoria}`, `Grupo: ${record.groupId}`, '', '## Trecho literal da conquista', '', record.integra, ''].join('\n'), 'utf8');
    }
  }
}
