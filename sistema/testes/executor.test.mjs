import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, utimes, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Executor, acquireLock } from '../executor.mjs';
import { segmentText } from '../contratos.mjs';
import { ensureFolders, writeJson } from '../arquivos.mjs';

function responseFor(options) {
  const source = JSON.parse(options.body);
  const segmentation = segmentText(source.text);
  return { ok: true, async json() { return {
    id: source.digestId, sourceId: source.sourceId, schemaVersion: 1,
    createdAt: source.createdAt, updatedAt: source.createdAt,
    originalText: source.text, segmentation,
    segmentedText: segmentation.segments.map(s => `[${s.id}] ${source.text.slice(s.start, s.end).trim()}`).join('\n'),
    keytopics: [{ id: 'SEG_00001', title: 'Ideia principal', bulletpoints: ['Ponto expresso no texto.'] }],
  }; } };
}

async function setup(t, request) {
  const root = await mkdtemp(join(tmpdir(), 'segundo-cerebro-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executor = new Executor(root, { digestWebhook: 'http://example.invalid', stableForMs: 1 }, { request, log() {} });
  await executor.initialize();
  return { root, executor };
}

test('lote aceita nomes livres, respeita datas, salva originais/digestões e arquiva entradas', async t => {
  const calls = [];
  const { root, executor } = await setup(t, async (_, options) => {
    calls.push(JSON.parse(options.body).text);
    return responseFor(options);
  });
  await writeFile(join(root, 'Entrada', 'Z — primeiro.txt'), '\ufeff  Primeiro texto. Café ☕.\r\n');
  await writeFile(join(root, 'Entrada', 'A — depois.txt'), 'Segundo texto.');
  await writeFile(join(root, 'Entrada', 'README.md'), 'Não processar');
  await utimes(join(root, 'Entrada', 'Z — primeiro.txt'), 100, 100);
  await utimes(join(root, 'Entrada', 'A — depois.txt'), 200, 200);
  await executor.batch();
  assert.deepEqual(calls, ['\ufeff  Primeiro texto. Café ☕.\r\n', 'Segundo texto.']);
  assert.equal(executor.state.jobs.length, 2);
  assert.ok(executor.state.jobs.every(j => j.status === 'completed'));
  assert.deepEqual(await readdir(join(root, 'Entrada')), ['README.md']);
  const first = executor.state.jobs[0];
  assert.equal(await readFile(join(root, first.originalFile), 'utf8'), calls[0]);
  assert.equal((await readdir(join(root, 'Digestões'))).length, 4);
  assert.equal((await readdir(join(root, 'Processados'))).length, 2);
  await executor.batch();
  assert.equal(calls.length, 2);
});

test('falha conserva original, pausa ordem e nova tentativa reutiliza identidade', async t => {
  let broken = true;
  let calls = 0;
  const { root, executor } = await setup(t, async (_, options) => {
    calls++;
    if (broken) throw new Error('Falha de comunicação de teste');
    return responseFor(options);
  });
  await writeFile(join(root, 'Entrada', 'um.txt'), 'Primeira ideia.');
  await writeFile(join(root, 'Entrada', 'dois.txt'), 'Segunda ideia.');
  await utimes(join(root, 'Entrada', 'um.txt'), 100, 100);
  await utimes(join(root, 'Entrada', 'dois.txt'), 200, 200);
  await executor.batch();
  const id = executor.state.jobs[0].id;
  assert.equal(calls, 2);
  assert.equal(executor.state.jobs[0].status, 'failed');
  assert.equal(executor.state.jobs[1].status, 'queued');
  assert.equal((await readdir(join(root, 'Erros'))).length, 1);
  broken = false;
  await executor.batch({ retry: true });
  assert.equal(executor.state.jobs[0].id, id);
  assert.ok(executor.state.jobs.every(j => j.status === 'completed'));
  assert.equal(executor.state.jobs.length, 2);
  assert.equal((await readdir(join(root, 'Erros'))).length, 0);
});

test('retoma resultado já salvo sem chamar novamente o modelo', async t => {
  let calls = 0;
  const { root, executor } = await setup(t, async (_, options) => { calls++; return responseFor(options); });
  await writeFile(join(root, 'Entrada', 'retomada.txt'), 'Resultado salvo.');
  await executor.discover();
  await new Promise(resolve => setTimeout(resolve, 5));
  await executor.discover();
  const job = executor.state.jobs[0];
  const digest = await responseFor({ body: JSON.stringify({ sourceId: job.id, digestId: job.digestId, createdAt: job.createdAt, text: 'Resultado salvo.' }) }).json();
  await writeJson(join(root, 'Digestões', `${job.baseName}.json`), digest);
  job.status = 'processing';
  await executor.save();
  const restarted = new Executor(root, executor.config, { request: async () => { throw new Error('Não deveria chamar o modelo'); }, log() {} });
  await restarted.initialize();
  await restarted.batch();
  assert.equal(calls, 0);
  assert.equal(restarted.state.jobs[0].status, 'completed');
  assert.equal((await readdir(join(root, 'Processados'))).length, 1);
});

test('arquivo UTF-8 inválido falha sem envio para o n8n', async t => {
  const { root, executor } = await setup(t, async () => { throw new Error('Não deveria chamar o n8n'); });
  await writeFile(join(root, 'Entrada', 'invalid.txt'), Buffer.from([0xc3, 0x28]));
  await executor.batch();
  assert.equal(executor.state.jobs[0].status, 'failed');
  assert.match(executor.state.jobs[0].error, /UTF-8/);
  assert.equal(executor.state.jobs[0].attempts, 0);
});

test('bloqueia dois executores ativos no mesmo diretório', async t => {
  const root = await mkdtemp(join(tmpdir(), 'segundo-cerebro-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureFolders(root);
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /já está aberto/);
  await release();
});

test('cópia de pasta aberta inicia e processa sem compartilhar bloqueio ou dados', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'segundo-cerebro-clientes-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const first = join(parent, 'Cliente 1 — João'), second = join(parent, 'Cliente 2 — Maria');
  await ensureFolders(first);
  const releaseFirst = await acquireLock(first);
  t.after(releaseFirst);
  await cp(first, second, { recursive: true });
  const releaseSecond = await acquireLock(second);
  t.after(releaseSecond);
  await assert.rejects(acquireLock(first), /já está aberto/);
  await assert.rejects(acquireLock(second), /já está aberto/);
  const makeExecutor = root => new Executor(root, { digestWebhook: 'http://example.invalid', stableForMs: 1 }, { request: async (_, options) => responseFor(options), log() {} });
  const a = makeExecutor(first), b = makeExecutor(second);
  await Promise.all([a.initialize(), b.initialize()]);
  await Promise.all([writeFile(join(first, 'Entrada', 'texto.txt'), 'Texto do cliente um.'), writeFile(join(second, 'Entrada', 'texto.txt'), 'Texto do cliente dois.')]);
  await Promise.all([a.batch(), b.batch()]);
  assert.notEqual(a.state.id, b.state.id);
  assert.notEqual(a.state.jobs[0].id, b.state.jobs[0].id);
  for (const [executor, text] of [[a, 'Texto do cliente um.'], [b, 'Texto do cliente dois.']]) {
    assert.equal(executor.state.jobs.length, 1);
    assert.equal(executor.state.jobs[0].status, 'completed');
    const saved = JSON.parse(await readFile(join(executor.root, executor.state.jobs[0].digestFile), 'utf8'));
    assert.equal(saved.originalText, text);
  }
});

test('bloqueio copiado de outro computador não bloqueia a pasta local', async t => {
  const root = await mkdtemp(join(tmpdir(), 'segundo-cerebro-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureFolders(root);
  await writeFile(join(root, 'sistema', 'executor.lock'), JSON.stringify({ pid: process.pid, root, hostname: 'outro-computador-teste', token: 'copiado' }));
  const release = await acquireLock(root);
  await release();
});

test('bloqueio antigo continua protegendo execução ativa e explica como tratar cópia', async t => {
  const root = await mkdtemp(join(tmpdir(), 'segundo-cerebro-legacy-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureFolders(root);
  await writeFile(join(root, 'sistema', 'executor.lock'), String(process.pid));
  await assert.rejects(acquireLock(root), /bloqueio antigo.*remova somente sistema\/executor.lock/);
});

test('ignora texto inválido sem perder original e segue com o próximo', async t => {
  const { root, executor } = await setup(t, async (_, options) => responseFor(options));
  await writeFile(join(root, 'Entrada', 'vazio.txt'), '');
  await writeFile(join(root, 'Entrada', 'valido.txt'), 'Conhecimento explícito.');
  await utimes(join(root, 'Entrada', 'vazio.txt'), 100, 100);
  await utimes(join(root, 'Entrada', 'valido.txt'), 200, 200);
  await executor.batch();
  const original = executor.state.jobs[0].originalFile;
  assert.equal(executor.state.jobs[0].status, 'failed');
  await executor.ignoreFirstError();
  assert.equal(executor.state.jobs[0].status, 'skipped');
  assert.equal(executor.state.jobs[1].status, 'completed');
  assert.equal(await readFile(join(root, original), 'utf8'), '');
});

test('escuta contínua recebe arquivo novo depois de iniciar', async t => {
  let executor;
  const setupResult = await setup(t, async (_, options) => {
    executor.stopping = true;
    return responseFor(options);
  });
  executor = setupResult.executor;
  executor.config.pollIntervalMs = 5;
  const watching = executor.watch();
  await new Promise(resolve => setTimeout(resolve, 10));
  await writeFile(join(setupResult.root, 'Entrada', 'novo.txt'), 'Texto recebido durante a escuta.');
  await watching;
  assert.equal(executor.state.jobs.length, 1);
  assert.equal(executor.state.jobs[0].status, 'completed');
});

test('entrada explica arquivos ignorados e textos já registrados sem repetir os avisos', async t => {
  const { root, executor } = await setup(t, async (_, options) => responseFor(options));
  const logs = []; executor.log = message => logs.push(message);
  await writeFile(join(root, 'Entrada', 'texto.txt.docx'), 'Extensão errada.');
  await writeFile(join(root, 'Entrada', 'README.md'), 'Instruções.');
  await writeFile(join(root, 'Entrada', 'texto.TXT'), 'Texto registrado.');
  await executor.discover();
  await new Promise(resolve => setTimeout(resolve, 5));
  await executor.discover();
  await executor.discover(); await executor.discover();
  assert.equal(executor.state.jobs.length, 1);
  assert.equal(logs.filter(line => line.startsWith('Arquivo ignorado:')).length, 1);
  assert.equal(logs.filter(line => line.startsWith('Encontrado na Entrada:')).length, 1);
  assert.equal(logs.filter(line => line.startsWith('Já registrado nesta cópia:')).length, 1);
  assert.ok(logs.every(line => !line.includes('README.md')));
});
