import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiaryProcessor } from '../diario.mjs';
import { Executor } from '../executor.mjs';
import { segmentText } from '../contratos.mjs';
import { readNoul, readAspects, combineAspectResponses, prepareAspectActions, combineFinalization, validateBragOutput } from '../contratos-diario.mjs';

const config = { diaryWebhook: 'http://example.invalid/diary', digestWebhook: 'http://example.invalid/digest',
  model: 'test-model', requestTimeoutMs: 1000, continuityThreshold: 0.8, aspectThreshold: 0.8, maxGroupCharacters: 120000, stableForMs: 1 };
const reply = value => ({ ok: true, async json() { return value; } });
const decision = accepted => ({ probability: accepted ? 0.95 : 0.05, threshold: 0.8, accepted });
function digest(id, text = 'Concluí a entrega para o cliente.') {
  const segmentation = segmentText(text);
  return { id: id + '-digest-v1', sourceId: id, schemaVersion: 1, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', originalText: text, segmentation,
    segmentedText: segmentation.segments.map(s => `[${s.id}] ${text.slice(s.start, s.end).trim()}`).join('\n'), keytopics: [{ id: 'SEG_00001', title: text, bulletpoints: [text] }] };
}
function aspects(victory = true) {
  const flags = { victory, obstacle: false, story: true, gratitude: false, joke: false, personalLife: false };
  return { flags, decisions: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, decision(v)])) };
}
function normalResponse(p, { continues = false, victory = true } = {}) {
  if (p.operation === 'compare') return reply({ ok: true, decision: decision(continues) });
  if (p.operation === 'finalize') return reply({ ok: true, aspects: aspects(victory), diary: { title: 'Uma entrega concluída', summary: 'Entreguei o trabalho.' }, achievements: victory ? [{ evento: 'Entrega concluída', descricao: 'Trabalho entregue ao cliente.', categoria: 'entrega', integra: p.text.split('\n\n')[0] }] : [], errors: {} });
  throw new Error('Operação inesperada');
}
async function setup(t, request) {
  const root = await mkdtemp(join(tmpdir(), 'diario-local-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const diary = new DiaryProcessor(root, config, { request, log() {} });
  await diary.initialize();
  return { root, diary };
}

test('Jev exige seis respostas válidas e erro nunca vira quebra de continuidade', () => {
  assert.equal(readNoul({ answers: { continuidade: { type: 'noul', noul: 0.8 } } }, 'continuidade', 0.8).accepted, true);
  for (const noul of [null, '0.9', -1, 2]) assert.throws(() => readNoul({ answers: { continuidade: { type: 'noul', noul } } }, 'continuidade', 0.8));
  assert.throws(() => readAspects({ answers: {} }, 0.8));
});

test('seis respostas independentes preservam várias flags true e rotas ativas', () => {
  const values = { victory: 0.95, obstacle: 0.9, story: 0.85, gratitude: 0.1, joke: 0.2, personalLife: 0.3 };
  const responses = Object.fromEntries(Object.entries(values).map(([key, noul]) => [key, { answers: { [key]: { type: 'noul', noul } } }]));
  const result = combineAspectResponses(responses, 0.8);
  assert.deepEqual(result.activeRoutes, ['victory', 'obstacle', 'story']);
  assert.equal(result.aspects.flags.gratitude, false);
  assert.equal(result.aspects.decisions.obstacle.probability, 0.9);
  assert.throws(() => combineAspectResponses({ ...responses, obstacle: { error: 'Falha HTTP' } }, 0.8), /obstacle/);
});

test('Code do workflow reúne seis Requests; falha de um aspecto retorna erro estruturado', async () => {
  const specs = JSON.parse(await readFile(new URL('../workflows/02b-diario.nodes.json', import.meta.url), 'utf8'));
  const aggregate = specs.find(n => n.name === 'Reunir aspectos e definir rotas');
  const names = ['Vitória', 'Obstáculo', 'História', 'Gratidão', 'Piada', 'Vida pessoal'];
  const keys = ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife'];
  const outputs = { 'Validar pedido do Diário': { threshold: 0.8 } };
  names.forEach((label, i) => { outputs['Jev — ' + label] = { answers: { [keys[i]]: { type: 'noul', noul: 0.1 } } }; });
  const run = () => new Function('$', aggregate.parameters.jsCode)(name => ({ first: () => ({ json: outputs[name] }) }))[0].json;
  assert.equal(run().ok, true);
  assert.deepEqual(run().activeRoutes, []);
  outputs['Jev — Piada'] = { error: 'API indisponível' };
  assert.equal(run().ok, false);
  assert.match(run().error.message, /joke/);
});

test('Brag aceita somente trecho literal e categoria permitida', () => {
  const item = { evento: 'Entrega', descricao: 'Entreguei o trabalho.', categoria: 'entrega', integra: 'Concluí a entrega.' };
  assert.equal(validateBragOutput({ achievements: [item] }, '  Concluí a entrega.\n')[0].integra, item.integra);
  assert.throws(() => validateBragOutput({ achievements: [{ ...item, integra: 'Finalizei a entrega.' }] }, 'Concluí a entrega.'));
  assert.throws(() => validateBragOutput({ achievements: [{ ...item, categoria: 'inventada' }] }, 'Concluí a entrega.'));
});

test('primeiro input mantém janela aberta, sem finalizar por fim de execução ou reinício', async t => {
  let calls = 0;
  const { root, diary } = await setup(t, async () => { calls++; throw new Error('Não deve chamar IA'); });
  await diary.accept(digest('a'), 'Primeiro.txt');
  await diary.finalizePending();
  const restarted = new DiaryProcessor(root, config, { request: async () => { calls++; throw new Error('Não deve chamar IA'); }, log() {} });
  await restarted.initialize(); await restarted.finalizePending();
  assert.equal(calls, 0);
  assert.equal(restarted.state.openGroupId, 'a-group-v1');
  assert.equal(restarted.state.groups[0].status, 'open');
  assert.match(await readFile(join(root, 'Diário', 'Grupo em andamento.md'), 'utf8'), /Aguardando o próximo texto/);
  assert.equal((await readdir(join(root, 'Diário'))).filter(n => n.endsWith('.json')).length, 0);
});

test('A+B permanecem juntos até C romper; comparação usa o último input e C abre outro grupo', async t => {
  const comparisons = []; let finalized = 0;
  const { root, diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body);
    if (p.operation === 'compare') { comparisons.push([p.first.sourceId, p.second.sourceId]); return normalResponse(p, { continues: p.second.sourceId === 'b' }); }
    if (p.operation === 'finalize') finalized++;
    return normalResponse(p);
  });
  await diary.accept(digest('a', '  Concluí a entrega para o cliente. ☕\n'), 'A.txt');
  await diary.accept(digest('b', 'O cliente aprovou a entrega.'), 'B.txt');
  await diary.finalizePending(); assert.equal(finalized, 0);
  const restarted = new DiaryProcessor(root, config, { request: diary.request, log() {} });
  await restarted.initialize();
  await restarted.accept(digest('c', 'Fui à praia com a família.'), 'C.txt');
  await restarted.finalizePending();
  assert.deepEqual(comparisons, [['a', 'b'], ['b', 'c']]);
  const [closed, open] = restarted.state.groups;
  assert.deepEqual(closed.sourceIds, ['a', 'b']); assert.deepEqual(open.sourceIds, ['c']);
  assert.equal(closed.fullText, '  Concluí a entrega para o cliente. ☕\n\n\nO cliente aprovou a entrega.');
  assert.equal(closed.diaryStatus, 'completed'); assert.equal(open.status, 'open');
  const record = JSON.parse(await readFile(join(root, closed.diaryFile), 'utf8'));
  assert.equal(record.achievementIds.length, 1); assert.equal(record.keytopicsBySource.length, 2);
  await restarted.accept(digest('c', 'Fui à praia com a família.'), 'C.txt');
  await restarted.finalizePending(); assert.equal(finalized, 1);
  assert.equal((await readdir(join(root, 'Conquistas'))).filter(n => n.endsWith('.json')).length, 1);
});

test('resposta inválida de continuidade conserva grupo e não inclui input até nova tentativa', async t => {
  let invalid = true;
  const { diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body);
    return invalid ? reply({ ok: true, decision: { probability: null, threshold: 0.8, accepted: false } }) : normalResponse(p, { continues: true });
  });
  await diary.accept(digest('a'), 'A.txt');
  await assert.rejects(diary.accept(digest('b'), 'B.txt'), /Decisão Jev inválida/);
  assert.deepEqual(diary.state.groups[0].sourceIds, ['a']);
  invalid = false; await diary.accept(digest('b'), 'B.txt');
  assert.deepEqual(diary.state.groups[0].sourceIds, ['a', 'b']);
});

test('grupo sem vitória salva Diário e não chama Escrivão Brag', async t => {
  const calls = [];
  const { diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); calls.push(p.operation);
    return normalResponse(p, { victory: false });
  });
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt'); await diary.finalizePending();
  assert.equal(diary.state.groups[0].diaryStatus, 'completed');
  assert.equal(diary.state.groups[0].bragStatus, 'skipped');
  assert.ok(!calls.includes('brag'));
  assert.deepEqual(calls, ['compare', 'finalize']);
});

test('uma única chamada finaliza aspectos, Diário e ações, com Gratidão sem Vitória', async t => {
  const calls = [];
  const { root, diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); calls.push(p);
    const result = await normalResponse(p, { victory: false }).json();
    if (p.operation === 'finalize') {
      result.aspects.flags.gratitude = true; result.aspects.decisions.gratitude = decision(true);
    }
    return reply(result);
  });
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt');
  await diary.finalizePending();
  assert.deepEqual(calls.map(p => p.operation), ['compare', 'finalize']);
  assert.equal(calls[1].groupId, 'a-group-v1'); assert.deepEqual(calls[1].sourceIds, ['a']);
  const record = JSON.parse(await readFile(join(root, diary.state.groups[0].diaryFile), 'utf8'));
  assert.equal(record.flags.gratitude, true); assert.equal(record.flags.victory, false);
  await diary.finalizePending();
  assert.equal(calls.length, 2);
  assert.equal(diary.state.groups[0].bragStatus, 'skipped');
});

test('todas as ações true são percorridas; resultado completo mantém Diário mesmo com falha Brag', () => {
  const context = { text: 'Concluí a entrega.', aspects: aspects(), diary: { title: 'Entrega', summary: 'Concluí.' }, errors: {} };
  context.aspects.flags.gratitude = true;
  const actions = prepareAspectActions(context);
  assert.deepEqual(actions.map(a => a.aspect), ['victory', 'story', 'gratitude']);
  const completed = actions.map(a => a.aspect === 'victory' ? { ...a, errors: { brag: 'Falha do modelo' } } : a);
  const result = combineFinalization(completed);
  assert.equal(result.ok, true); assert.deepEqual(result.diary, context.diary);
  assert.equal(result.errors.brag, 'Falha do modelo'); assert.equal(result.actionResults[0].status, 'failed');
  assert.equal(result.activeRoutes.length, 3);
  const flags = Object.fromEntries(Object.keys(context.aspects.flags).map(key => [key, false]));
  const none = prepareAspectActions({ ...context, aspects: { flags } });
  assert.deepEqual(none.map(a => a.aspect), ['none']);
  assert.deepEqual(combineFinalization(none).achievements, []);
  assert.throws(() => prepareAspectActions({ aspects: { flags: { victory: true } } }), /inválidos/);
});

test('falha parcial do Brag conserva Diário e nova tentativa usa uma finalização completa', async t => {
  let broken = true; const calls = [];
  const { root, diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); calls.push(p.operation);
    const result = await normalResponse(p).json();
    if (p.operation === 'finalize' && broken) { result.achievements = []; result.errors = { brag: 'Falha Brag' }; }
    return reply(result);
  });
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt'); await diary.finalizePending();
  const group = diary.state.groups[0];
  assert.equal(group.diaryStatus, 'completed'); assert.equal(group.bragStatus, 'failed');
  assert.ok(await readFile(join(root, group.diaryFile), 'utf8'));
  const title = group.diaryOutput.title;
  broken = false; await diary.finalizePending({ retry: true });
  assert.deepEqual(calls, ['compare', 'finalize', 'finalize']);
  assert.equal(group.diaryOutput.title, title); assert.equal(group.bragStatus, 'completed');
  assert.equal((await readdir(join(root, 'Erros'))).length, 0);
});

test('falha parcial no Diário conserva aspectos e conquistas para retomada', async t => {
  let broken = true; const calls = [];
  const { diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); calls.push(p.operation);
    const result = await normalResponse(p).json();
    if (p.operation === 'finalize' && broken) { result.diary = null; result.errors = { diary: 'Falha Diário' }; }
    return reply(result);
  });
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt'); await diary.finalizePending();
  assert.equal(diary.state.groups[0].diaryStatus, 'failed'); assert.equal(diary.state.openGroupId, 'b-group-v1');
  assert.equal(diary.state.groups[0].aspects.flags.victory, true);
  assert.equal(diary.state.groups[0].achievements.length, 1);
  broken = false; await diary.finalizePending({ retry: true });
  assert.deepEqual(calls, ['compare', 'finalize', 'finalize']);
  assert.equal(diary.state.groups[0].diaryStatus, 'completed');
});

test('falha na escrita local reutiliza a resposta completa sem repetir a finalização', async t => {
  const calls = [];
  const { diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); calls.push(p.operation); return normalResponse(p);
  });
  const write = diary.writeDiary.bind(diary);
  let broken = true;
  diary.writeDiary = async group => { if (broken) throw new Error('Falha de disco de teste'); await write(group); };
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt'); await diary.finalizePending();
  assert.equal(diary.state.groups[0].diaryStatus, 'failed');
  assert.equal(diary.state.groups[0].achievements.length, 1);
  broken = false; await diary.finalizePending({ retry: true });
  assert.deepEqual(calls, ['compare', 'finalize']);
  assert.equal(diary.state.groups[0].bragStatus, 'completed');
});

test('grupo acima do limite conserva texto completo e nunca fecha por tamanho', async t => {
  const { diary } = await setup(t, async (_, options) => normalResponse(JSON.parse(options.body), { continues: true }));
  diary.config = { ...config, maxGroupCharacters: 5 };
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt');
  await diary.finalizePending();
  assert.equal(diary.state.groups[0].status, 'open');
  diary.request = async (_, options) => normalResponse(JSON.parse(options.body));
  await diary.accept(digest('c'), 'C.txt'); await diary.finalizePending();
  assert.equal(diary.state.groups[0].diaryStatus, 'failed');
  assert.ok(diary.state.groups[0].fullText.length > 5);
});

test('vitória sem conquista factual registra divergência sem inventar evento', async t => {
  const { root, diary } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body);
    const result = await normalResponse(p).json(); if (p.operation === 'finalize') result.achievements = []; return reply(result);
  });
  await diary.accept(digest('a'), 'A.txt'); await diary.accept(digest('b'), 'B.txt'); await diary.finalizePending();
  assert.match(diary.state.groups[0].bragDivergence, /não extraiu/);
  assert.equal((await readdir(join(root, 'Conquistas'))).length, 0);
});

test('executor inicia Atlas e Diário em paralelo, aguardando ambos antes de avançar', { timeout: 3000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'diario-parallel-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const executor = new Executor(root, { ...config, atlasWebhook: 'http://example.invalid/atlas' }, { log() {}, request: async (_, options) => {
    const p = JSON.parse(options.body); const value = digest(p.sourceId, p.text); value.createdAt = p.createdAt; return reply(value);
  } });
  await executor.initialize();
  const started = []; let resolve;
  const gate = new Promise(r => { resolve = r; });
  t.after(() => resolve());
  executor.atlas.run = async () => { started.push('atlas'); if (started.length === 2) resolve(); await gate; };
  executor.diary.accept = async () => { started.push('diary'); if (started.length === 2) resolve(); await gate; };
  await writeFile(join(root, 'Entrada', 'Livre.txt'), 'Uma ideia.');
  await executor.batch();
  assert.deepEqual(started.sort(), ['atlas', 'diary']);
  assert.equal(executor.state.jobs[0].atlasStatus, 'completed'); assert.equal(executor.state.jobs[0].diaryStatus, 'completed');
});

test('falha de continuidade pausa próximo input e retry não repete digestão', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diario-order-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  let broken = true; let digestCalls = 0;
  const executor = new Executor(root, config, { log() {}, request: async (url, options) => {
    const p = JSON.parse(options.body);
    if (url === config.digestWebhook) { digestCalls++; const d = digest(p.sourceId, p.text); d.createdAt = p.createdAt; return reply(d); }
    if (p.operation === 'compare' && broken) throw new Error('Falha temporária');
    return normalResponse(p, { continues: true });
  } });
  await executor.initialize();
  for (let i = 0; i < 3; i++) { const file = join(root, 'Entrada', `${i}.txt`); await writeFile(file, `Ideia ${i}.`); await utimes(file, 100 + i, 100 + i); }
  await executor.batch();
  assert.equal(digestCalls, 2); assert.equal(executor.state.jobs[1].diaryStatus, 'failed'); assert.equal(executor.state.jobs[2].status, 'queued');
  broken = false; await executor.batch({ retry: true });
  assert.equal(digestCalls, 3); assert.equal(executor.diary.state.groups[0].inputs.length, 3);
  assert.ok(executor.state.jobs.every(j => j.diaryStatus === 'completed'));
});
