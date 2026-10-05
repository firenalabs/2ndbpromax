import { randomUUID, createHash } from 'node:crypto';
import { readdir, stat, readFile, writeFile, rename, unlink, open, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { folders, readJson, writeJson, ensureFolders, readableName, digestMarkdown } from './arquivos.mjs';
import { validateDigest } from './contratos.mjs';
import { AtlasProcessor } from './atlas.mjs';
import { DiaryProcessor } from './diario.mjs';

export const defaults = {
  pollIntervalMs: 1500, stableForMs: 1500, requestTimeoutMs: 180000,
  maxTextCharacters: 120000, maxFileBytes: 512000,
  knowledgeThreshold: 0.8,
  continuityThreshold: 0.8, aspectThreshold: 0.8, maxGroupCharacters: 120000,
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export class Executor {
  constructor(root, config, { request = fetch, log = console.log } = {}) {
    this.root = root;
    this.config = { ...defaults, ...config };
    this.request = request;
    this.log = log;
    this.observed = new Map();
    this.inputNotices = new Set();
    this.statePath = join(root, 'sistema', 'estado.json');
    this.stopping = false;
    this.atlas = this.config.atlasWebhook ? new AtlasProcessor(root, this.config, { request, log }) : null;
    this.diary = this.config.diaryWebhook ? new DiaryProcessor(root, this.config, { request, log }) : null;
    this.saveQueue = Promise.resolve();
  }

  async initialize() {
    await ensureFolders(this.root);
    const now = new Date().toISOString();
    this.state = await readJson(this.statePath, {
      id: randomUUID(), createdAt: now, updatedAt: now, schemaVersion: 1,
      nextSequence: 1, jobs: [],
    });
    if (this.state.schemaVersion !== 1 || !Array.isArray(this.state.jobs)) throw new Error('Registro local incompatível. Conserve os arquivos e confira sistema/estado.json.');
    for (const job of this.state.jobs) {
      if (job.status === 'processing') job.status = 'queued';
      if (this.atlas && job.status === 'completed' && (!job.atlasStatus || job.atlasStatus === 'processing')) job.atlasStatus = 'pending';
      if (this.diary && job.status === 'completed' && (!job.diaryStatus || job.diaryStatus === 'processing')) job.diaryStatus = 'pending';
    }
    if (this.atlas) await this.atlas.initialize();
    if (this.diary) await this.diary.initialize();
    await this.save();
  }

  async save() {
    const write = this.saveQueue.then(async () => {
      this.state.updatedAt = new Date().toISOString();
      await writeJson(this.statePath, this.state);
    });
    this.saveQueue = write.catch(() => {});
    return write;
  }

  async discover() {
    const entries = await readdir(join(this.root, folders.input), { withFileTypes: true });
    const candidates = [];
    let settling = false;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.txt$/i.test(entry.name)) {
        if (entry.name !== 'README.md' && !this.inputNotices.has(entry.name)) {
          this.inputNotices.add(entry.name);
          this.log(`Arquivo ignorado: ${entry.name}. A Entrada aceita somente arquivos .txt; confira a extensão completa no Windows.`);
        }
        continue;
      }
      const filePath = join(this.root, folders.input, entry.name);
      let info;
      try { info = await stat(filePath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const fingerprint = `${entry.name}:${info.mtimeMs}:${info.size}`;
      if (this.state.jobs.some(job => job.fingerprint === fingerprint)) {
        if (!this.inputNotices.has(fingerprint)) {
          this.inputNotices.add(fingerprint);
          this.log(`Já registrado nesta cópia: ${entry.name}. Consulte o andamento na opção 4; use a opção 3 para tentar novamente se houve erro.`);
        }
        continue;
      }
      const observed = this.observed.get(entry.name);
      if (!observed || observed.fingerprint !== fingerprint) {
        this.observed.set(entry.name, { fingerprint, since: Date.now() });
        if (!observed) this.log(`Encontrado na Entrada: ${entry.name}. Aguardando a cópia terminar…`);
        settling = true;
        continue;
      }
      if (Date.now() - observed.since < this.config.stableForMs) { settling = true; continue; }
      candidates.push({ name: entry.name, path: filePath, info, fingerprint });
    }
    candidates.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs || a.name.localeCompare(b.name, 'pt-BR'));
    for (const candidate of candidates) {
      const current = await stat(candidate.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!current || current.size !== candidate.info.size || current.mtimeMs !== candidate.info.mtimeMs) { settling = true; continue; }
      const bytes = await readFile(candidate.path);
      const afterRead = await stat(candidate.path);
      if (afterRead.size !== current.size || afterRead.mtimeMs !== current.mtimeMs) { settling = true; continue; }
      const now = new Date().toISOString();
      const id = randomUUID();
      const baseName = readableName(candidate.name, now, id);
      const job = {
        id, sourceId: id, digestId: `${id}-digest-v1`, createdAt: now, updatedAt: now, schemaVersion: 1,
        sequence: this.state.nextSequence++, inputName: candidate.name, baseName,
        fingerprint: candidate.fingerprint, contentHash: sha256(bytes), originalBytes: bytes.length,
        originalFile: join(folders.originals, `${baseName}.txt`), status: 'queued', attempts: 0,
      };
      await writeFile(join(this.root, job.originalFile), bytes);
      await writeJson(join(this.root, folders.originals, `${baseName}.json`), {
        id, digestId: job.digestId, createdAt: now, updatedAt: now, schemaVersion: 1,
        originalFilename: candidate.name, contentHash: job.contentHash, byteLength: bytes.length, sequence: job.sequence,
      });
      this.state.jobs.push(job);
      await this.save();
      this.log(`Recebido: ${candidate.name}`);
    }
    return { added: candidates.length, settling };
  }

  async callWorkflow(job, text) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      job.attempts++;
      await this.save();
      try {
        const response = await this.request(this.config.digestWebhook, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sourceId: job.id, digestId: job.digestId, createdAt: job.createdAt, text }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        let digest;
        try { digest = await response.json(); }
        catch { throw new Error('O n8n não retornou JSON válido. Verifique se o workflow novo está ativo.'); }
        if (!response.ok || digest?.ok === false) {
          throw new Error(digest?.error?.message || `O n8n respondeu HTTP ${response.status}. Verifique o workflow de digestão.`);
        }
        return validateDigest(digest, { id: job.id, digestId: job.digestId, text });
      } catch (error) {
        lastError = error;
        if (attempt === 0) { this.log('Não foi possível concluir. Tentando mais uma vez…'); await sleep(500); }
      }
    }
    throw lastError;
  }

  async process(job) {
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    await this.save();
    this.log(`Processando: ${job.inputName}`);
    try {
      const bytes = await readFile(join(this.root, job.originalFile));
      if (bytes.length > this.config.maxFileBytes) throw new Error('Arquivo acima do limite de 512 KB do protótipo. Divida-o em textos menores.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('O arquivo precisa estar salvo como texto UTF-8. O original foi conservado.'); }
      if (!text.trim()) throw new Error('O arquivo está vazio.');
      if (text.length > this.config.maxTextCharacters) throw new Error('Texto acima do limite de 120.000 caracteres. Divida-o em textos menores.');
      const digestPath = join(this.root, folders.digests, `${job.baseName}.json`);
      const previous = await readJson(digestPath, null);
      const digest = previous ? validateDigest(previous, { id: job.id, digestId: job.digestId, text }) : await this.callWorkflow(job, text);
      await writeJson(digestPath, digest);
      await writeFile(join(this.root, folders.digests, `${job.baseName}.md`), digestMarkdown(digest, job.inputName), 'utf8');
      const inputPath = join(this.root, folders.input, job.inputName);
      const current = await readFile(inputPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current && sha256(current) === job.contentHash) {
        await rename(inputPath, join(this.root, folders.processed, `${job.baseName}.txt`));
      }
      job.status = 'completed';
      job.digestFile = join(folders.digests, `${job.baseName}.json`);
      if (this.atlas && !job.atlasStatus) job.atlasStatus = 'pending';
      if (this.diary && !job.diaryStatus) job.diaryStatus = 'pending';
      job.updatedAt = new Date().toISOString();
      delete job.error;
      await this.save();
      await unlink(join(this.root, folders.errors, `${job.baseName}.md`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      this.log(`Concluído: ${job.inputName} → Digestões`);
      return true;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      await this.save();
      await writeFile(join(this.root, folders.errors, `${job.baseName}.md`),
        `# Não foi possível processar ${job.inputName}\n\n${error.message}\n\nOrigem: ${job.id}\n\nO original foi conservado em Originais. Para tentar novamente, use a opção “Tentar novamente” do iniciador.\n`, 'utf8');
      this.log(`Não foi possível processar ${job.inputName}: ${error.message}\nVeja a pasta Erros. A sequência foi pausada.`);
      return false;
    }
  }

  async processQueue() {
    if (this.diary) await this.diary.finalizePending();
    for (const job of [...this.state.jobs].sort((a, b) => a.sequence - b.sequence)) {
      if (this.stopping) break;
      if (job.status === 'failed') break;
      if (job.status === 'queued' && !await this.process(job)) break;
      if (job.status === 'completed') {
        const tasks = [];
        if (this.atlas && job.atlasStatus === 'pending') tasks.push(this.processAtlas(job));
        if (this.diary && job.diaryStatus === 'pending') tasks.push(this.processDiary(job));
        const results = await Promise.allSettled(tasks);
        const failed = results.find(r => r.status === 'rejected');
        if (failed) throw failed.reason;
        if (this.diary && job.diaryStatus === 'failed') break;
      }
    }
  }

  async processDiary(job) {
    job.diaryStatus = 'processing'; await this.save();
    try {
      const digest = await readJson(join(this.root, job.digestFile), null);
      if (!digest) throw new Error('A digestão deste texto não foi encontrada.');
      await this.diary.accept(digest, job.inputName);
      job.diaryStatus = 'completed'; delete job.diaryError;
      await unlink(join(this.root, folders.errors, `Continuidade — ${job.baseName}.md`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      await this.diary.finalizePending();
    } catch (error) {
      job.diaryStatus = 'failed'; job.diaryError = error.message;
      await writeFile(join(this.root, folders.errors, `Continuidade — ${job.baseName}.md`),
        `# Continuidade pendente: ${job.inputName}\n\n${error.message}\n\nO original, a digestão e o grupo anterior ficaram conservados. A sequência foi pausada. Use “Tentar novamente” no iniciador, ou ignore este input para continuar sem incluí-lo no Diário.\n`, 'utf8');
      this.log(`Comparação do Diário pendente: ${error.message}. A sequência foi pausada.`);
    }
    job.updatedAt = new Date().toISOString(); await this.save();
  }

  async processAtlas(job) {
    job.atlasStatus = 'processing';
    await this.save();
    try {
      this.log(`Organizando no Atlas: ${job.inputName}`);
      const digest = await readJson(join(this.root, job.digestFile), null);
      if (!digest) throw new Error('A digestão deste texto não foi encontrada.');
      await this.atlas.run(digest);
      job.atlasStatus = 'completed';
      delete job.atlasError;
      await unlink(join(this.root, folders.errors, `Atlas — ${job.baseName}.md`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } catch (error) {
      job.atlasStatus = 'failed';
      job.atlasError = error.message;
      await writeFile(join(this.root, folders.errors, `Atlas — ${job.baseName}.md`),
        `# Atlas pendente: ${job.inputName}\n\n${error.message}\n\nA digestão e os recortes já salvos foram conservados. Use “Tentar novamente” no iniciador. Os demais textos podem continuar.\n`, 'utf8');
      this.log(`Atlas pendente para ${job.inputName}: ${error.message}. A digestão permanece salva.`);
    }
    job.updatedAt = new Date().toISOString();
    await this.save();
  }

  async batch({ retry = false } = {}) {
    if (retry) {
      for (const job of this.state.jobs) if (job.status === 'failed') { job.status = 'queued'; delete job.error; }
      for (const job of this.state.jobs) if (job.atlasStatus === 'failed') { job.atlasStatus = 'pending'; delete job.atlasError; }
      for (const job of this.state.jobs) if (job.diaryStatus === 'failed') { job.diaryStatus = 'pending'; delete job.diaryError; }
      await this.save();
      if (this.diary) await this.diary.finalizePending({ retry: true });
    }
    let result = await this.discover();
    if (result.settling) { await sleep(this.config.stableForMs + 5); result = await this.discover(); }
    await this.processQueue();
    if (result.settling) this.log('Há arquivos ainda sendo copiados. Eles serão recebidos na próxima execução.');
    this.showStatus();
  }

  async ignoreFirstError() {
    const job = this.state.jobs.find(j => j.status === 'failed');
    if (!job) {
      const diaryJob = this.state.jobs.find(j => j.diaryStatus === 'failed');
      if (diaryJob) {
        diaryJob.diaryStatus = 'skipped'; diaryJob.updatedAt = new Date().toISOString(); await this.save();
        this.log(`Diário ignorado para ${diaryJob.inputName}. O original e a digestão foram conservados.`);
        await this.batch(); return;
      }
      const atlasJob = this.state.jobs.find(j => j.atlasStatus === 'failed');
      if (!atlasJob) { this.log('Nenhum texto com erro para ignorar.'); return; }
      atlasJob.atlasStatus = 'skipped';
      atlasJob.updatedAt = new Date().toISOString();
      await this.save();
      this.log(`Atlas ignorado para ${atlasJob.inputName}. A digestão e os recortes foram conservados.`);
      await this.batch();
      return;
    }
    const inputPath = join(this.root, folders.input, job.inputName);
    const bytes = await readFile(inputPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (bytes && sha256(bytes) === job.contentHash) {
      await rename(inputPath, join(this.root, folders.errors, `${job.baseName}.txt`));
    }
    job.status = 'skipped';
    job.updatedAt = new Date().toISOString();
    await this.save();
    this.log(`Texto ignorado: ${job.inputName}. O original continua salvo em Originais.`);
    await this.batch();
  }

  async watch() {
    this.log(`Monitorando: ${join(this.root, folders.input)}`);
    this.log('Aguardando arquivos .txt. Para parar, pressione Ctrl+C.');
    if (process.platform === 'win32') this.log('Se a janela estiver com texto selecionado e parecer parada, pressione Esc para liberar o terminal.');
    const blocked = this.state.jobs.find(j => j.status === 'failed' || j.diaryStatus === 'failed');
    if (blocked) this.log(`A fila tem um erro anterior em ${blocked.inputName}. Use a opção 3 para tentar novamente ou 5 para ignorar.`);
    while (!this.stopping) {
      await this.discover();
      await this.processQueue();
      if (!this.stopping) await sleep(this.config.pollIntervalMs);
    }
    this.log('Sistema parado. Os dados ficaram salvos nesta pasta.');
  }

  showStatus() {
    const completed = this.state.jobs.filter(j => j.status === 'completed').length;
    const failed = this.state.jobs.filter(j => j.status === 'failed').length;
    const queued = this.state.jobs.filter(j => j.status === 'queued').length;
    this.log(`Concluídos: ${completed} | Aguardando: ${queued} | Com erro: ${failed}`);
    if (this.atlas) {
      const pendingAtlas = this.state.jobs.filter(j => j.status === 'completed' && ['pending', 'processing', 'failed'].includes(j.atlasStatus)).length;
      this.log(`Atlas: ${this.atlas.atlas.noteIds.length} nota(s) | ${pendingAtlas} texto(s) pendente(s). Veja Atlas/Atlas de Conhecimento.md.`);
    }
    if (this.diary) {
      const groups = this.diary.state.groups;
      const open = groups.find(g => g.status === 'open');
      const pending = groups.filter(g => g.status === 'closed' && (g.diaryStatus !== 'completed' || !['completed', 'skipped'].includes(g.bragStatus))).length;
      this.log(`Diário: ${groups.filter(g => g.diaryStatus === 'completed').length} registro(s) | ${pending} grupo(s) pendente(s).`);
      this.log(`Conteúdos Gerados: ${groups.filter(g => g.contentStatus === 'completed').length} conteúdo(s) | ${groups.filter(g => g.status === 'closed' && ['pending', 'failed'].includes(g.contentStatus)).length} pendente(s).`);
      const continuityErrors = this.state.jobs.filter(j => j.diaryStatus === 'failed').length;
      if (continuityErrors) this.log(`Continuidade pendente para ${continuityErrors} texto(s). Consulte Erros e use “Tentar novamente”.`);
      this.log(open ? `Grupo do Diário aguardando próximo texto: ${open.inputs.length} texto(s). Veja Diário/Grupo em andamento.md.` : 'Diário aguardando o primeiro texto.');
      this.log('Etapas 1, 2 e 3 disponíveis. Resultados em Digestões, Atlas, Diário e Conquistas.');
    } else this.log(this.atlas ? 'Etapas 1 e 2 disponíveis. Diário e Conquistas serão conectados na etapa 3.' : 'Etapa 1: digestão disponível.');
  }
}

export async function acquireLock(root) {
  const path = join(root, 'sistema', 'executor.lock');
  const identity = { pid: process.pid, root: await realpath(root), hostname: hostname(), token: randomUUID() };
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const contents = await readFile(path, 'utf8');
    let record;
    try { record = JSON.parse(contents); } catch { throw new Error('O registro de execução está inválido. Confira sistema/executor.lock.'); }
    const legacy = typeof record === 'number';
    const pid = legacy ? record : record?.pid;
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('O registro de execução está inválido. Confira sistema/executor.lock.');
    if (!legacy && (typeof record.root !== 'string' || typeof record.hostname !== 'string' || typeof record.token !== 'string')) throw new Error('O registro de execução está inválido. Confira sistema/executor.lock.');
    const sameInstance = legacy || (record.root === identity.root && record.hostname === identity.hostname);
    let running = sameInstance;
    if (sameInstance) try { process.kill(pid, 0); } catch (checkError) { if (checkError.code === 'ESRCH') running = false; }
    if (running) throw new Error(legacy
      ? 'O sistema já está aberto ou esta cópia trouxe um bloqueio antigo. Feche a execução desta pasta; se ela foi clonada e não está aberta, remova somente sistema/executor.lock nesta cópia e inicie novamente.'
      : `O sistema já está aberto nesta pasta: ${identity.root}. Use a janela que iniciou primeiro.`);
    await unlink(path);
    handle = await open(path, 'wx');
  }
  await handle.writeFile(JSON.stringify(identity));
  await handle.close();
  return async () => {
    try {
      const record = JSON.parse(await readFile(path, 'utf8'));
      if (record.token === identity.token) await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
