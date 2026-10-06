import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segmentText } from '../contratos.mjs';
import { buildBlocks, readKnowledge, readChoice, validateCategoryPath } from '../contratos-atlas.mjs';
import { insertZettelNote, advanceZettel, createZettelRoot, validateZettelTree, zettelFilename, letterAddress } from '../zettelkasten.mjs';
import { AtlasProcessor } from '../atlas.mjs';
import { Executor } from '../executor.mjs';
import { writeJson, readableName } from '../arquivos.mjs';

test('títulos longos com Unicode produzem nomes que cabem no sistema de arquivos', () => {
  const name = readableName('Conhecimento 🧠 '.repeat(100), '2026-10-03T00:00:00.000Z', '12345678-1234-1234-1234-123456789012 — SEG_00001');
  assert.ok(Buffer.byteLength(name + '.md', 'utf8') < 255);
  assert.ok(!name.includes('\uFFFD'));
});

function makeDigest(sourceId = 'source-a', text = '  Primeira ideia. Café ☕.\n\nSegunda ideia!  ', split = true) {
  const segmentation = segmentText(text);
  return { id: sourceId + '-digest-v1', sourceId, schemaVersion: 1,
    createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', originalText: text, segmentation,
    segmentedText: segmentation.segments.map(s => `[${s.id}] ${text.slice(s.start, s.end).trim()}`).join('\n'),
    keytopics: [
      { id: 'SEG_00001', title: 'Primeira ideia', bulletpoints: ['Ponto da primeira ideia.'] },
      ...(split ? [{ id: segmentation.segments.at(-1).id, title: 'Segunda ideia', bulletpoints: ['Outro ponto.'] }] : []),
    ],
  };
}

const config = { atlasWebhook: 'http://example.invalid/atlas', requestTimeoutMs: 1000, knowledgeThreshold: 0.8, maxCategoryDepth: 4 };
const jsonResponse = value => ({ ok: true, async json() { return value; } });
function note(block, accepted = true) {
  return { ok: true, accepted, block: { ...block, title: accepted ? 'Uma ideia útil' : null,
    knowledge: { probability: accepted ? 0.95 : 0.1, threshold: 0.8, accepted }, status: accepted ? 'prepared' : 'filtered' } };
}
function select(categories, id) {
  return { ok: true, action: id === 'none' ? 'create' : 'select', categoryId: id === 'none' ? null : id,
    decision: { choice: id, probabilities: Object.fromEntries([...categories.map(c => c.id), 'none'].map(c => [c, c === id ? 1 : 0])) } };
}
async function setup(t, request) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-local-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const atlas = new AtlasProcessor(root, config, { request, log() {} });
  await atlas.initialize();
  return { root, atlas };
}

test('workflow antigo informa o servidor e preserva os recortes sem repetir a chamada', async t => {
  let calls = 0;
  const { atlas } = await setup(t, async () => {
    calls++;
    return { ok: false, status: 422, async json() { return { ok: false, error: { message: 'Árvore ou profundidade de categorias inválida.' } }; } };
  });
  const digest = makeDigest();
  await assert.rejects(atlas.run(digest), /example\.invalid.*estrutura antiga.*opção 6.*preservadas/);
  assert.equal(calls, 1);
  assert.equal(atlas.atlas.notes.length, 0);
  for (const block of buildBlocks(digest)) {
    const saved = JSON.parse(await readFile(atlas.blockPath(block.id), 'utf8'));
    assert.equal(saved.text, block.text);
    assert.equal(saved.status, 'created');
  }
});

test('falha temporária do servidor ainda permite uma segunda tentativa', async t => {
  let calls = 0;
  const { atlas } = await setup(t, async (_, options) => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, async json() { return { error: { message: 'Temporariamente indisponível.' } }; } };
    return jsonResponse(processPayload(JSON.parse(options.body)));
  });
  await atlas.run(makeDigest());
  assert.equal(calls, 2);
  assert.equal(atlas.atlas.notes.length, 2);
});

test('cortes incluem frase inicial, preservam espaços e têm IDs globais por origem', () => {
  const digest = makeDigest();
  const blocks = buildBlocks(digest);
  assert.equal(blocks.map(b => b.text).join(''), digest.originalText);
  assert.equal(blocks[0].start, 0);
  assert.ok(blocks[1].text.startsWith('Segunda ideia!'));
  assert.equal(blocks[0].endSegmentIdExclusive, blocks[1].segmentId);
  assert.equal(blocks[1].endSegmentIdExclusive, null);
  assert.notEqual(blocks[0].id, buildBlocks(makeDigest('source-b'))[0].id);
  assert.equal(blocks[0].wordCount, (blocks[0].text.match(/\S+/g) ?? []).length);
});

test('conhecimento aplica limiar e respostas inválidas são erros, nunca false', () => {
  assert.equal(readKnowledge({ answers: { conhecimento_util: { type: 'noul', noul: 0.8 } } }, 0.8).accepted, true);
  assert.equal(readKnowledge({ answers: { conhecimento_util: { type: 'noul', noul: 0.79 } } }, 0.8).accepted, false);
  for (const value of [null, '0.9', NaN, 1.2, -0.1]) assert.throws(() => readKnowledge({ answers: { conhecimento_util: { type: 'noul', noul: value } } }, 0.8));
  assert.throws(() => readKnowledge({}, 0.8));
});

test('choice aceita none e rejeita categoria ou distribuição inventada', () => {
  const categories = [{ id: 'a' }];
  const good = { answers: { categoria: { type: 'choice', choice: 'none', probabilities: { a: 0.1, none: 0.9 } } } };
  assert.equal(readChoice(good, categories).choice, 'none');
  assert.throws(() => readChoice({ answers: { categoria: { ...good.answers.categoria, choice: 'unknown' } } }, categories));
  assert.throws(() => readChoice({ answers: { categoria: { ...good.answers.categoria, probabilities: { none: 1 } } } }, categories));
  assert.throws(() => validateCategoryPath([{ name: 'a', description: 'a' }, { name: 'b', description: 'b' }], 4, false));
});

function processPayload(p, { accepted = true, choose, path = [{ name: 'Marketing', description: 'Marketing digital.' }], fail = () => false } = {}) {
  let tree = p.categories, noteTree = p.notes;
  const blocks = []; const errors = [];
  for (const raw of p.blocks) {
    if (fail(raw)) { blocks.push(raw); errors.push({ blockId: raw.id, message: 'Falha no Jev' }); continue; }
    let context = { block: note(raw, accepted).block, tree, noteTree, categoryId: null, parentNoteId: null, ancestors: [] };
    if (accepted) {
      for (let depth = 0; depth <= noteTree.length + 2; depth++) {
        const options = context.categoryId === null ? context.tree : context.noteTree.filter(n=>n.categoryId===context.categoryId&&n.parentNoteId===context.parentNoteId);
        const id = choose ? choose(context, options) : context.categoryId === null ? options[0]?.id ?? 'none' : 'none';
        context = context.categoryId === null && id === 'none' ? createZettelRoot({ ...context, decision: options.length ? select(options, 'none').decision : null }, path)
          : advanceZettel(context, select(options, id).decision);
        if (context.complete) break;
      }
    }
    blocks.push(context.block); tree = context.tree; noteTree = context.noteTree;
  }
  return { ok: true, blocks, newCategories: tree.filter(c => !p.categories.some(original => original.id === c.id)),
    newNotes: noteTree.filter(n=>!p.notes.some(old=>old.id===n.id)), errors };
}

test('salva todos os recortes antes da IA e usa uma chamada mesmo com todos filtrados', async t => {
  let calls = 0; let root;
  const digest = makeDigest();
  const setupResult = await setup(t, async (_, options) => {
    calls++; const p = JSON.parse(options.body);
    assert.equal(p.operation, 'process'); assert.equal(p.blocks.length, 2);
    assert.equal((await readdir(join(root, 'Atlas', 'Recortes'))).length, 2);
    return jsonResponse(processPayload(p, { accepted: false }));
  }); root = setupResult.root;
  await setupResult.atlas.run(digest);
  assert.equal(calls, 1); assert.equal(setupResult.atlas.atlas.categories.length, 0);
  for (const block of buildBlocks(digest)) assert.equal(JSON.parse(await readFile(setupResult.atlas.blockPath(block.id), 'utf8')).status, 'filtered');
});

test('uma chamada processa vários recortes reutilizando categorias criadas pelo anterior', async t => {
  let calls = 0;
  const digest = makeDigest();
  const { root, atlas } = await setup(t, async (_, options) => {
    calls++; return jsonResponse(processPayload(JSON.parse(options.body)));
  });
  await atlas.run(digest);
  assert.equal(atlas.atlas.categories.length, 1); assert.equal(atlas.atlas.noteIds.length, 2);
  assert.equal(atlas.atlas.categories.at(-1).noteIds.length, 2);
  const document = await readFile(join(root, 'Atlas', 'Atlas de Conhecimento.md'), 'utf8');
  assert.match(document, /Marketing/);
  assert.match(document, /^# A\. Marketing\n\n## A\.1 Uma ideia útil\n\n## A\.2 Uma ideia útil\n$/);
  for (const n of atlas.atlas.notes) assert.equal(await readFile(join(root,'Atlas','Notas',zettelFilename(n)),'utf8'),buildBlocks(digest).find(b=>b.id===n.id).text);
  await atlas.run(digest); assert.equal(calls, 1);
  assert.equal((await readdir(join(root, 'Atlas', 'Notas'))).length, 2);
});

test('percorre títulos de notas e insere filho; none não cria subcategoria', async t => {
  let child = false;
  const { atlas } = await setup(t, async (_, options) => jsonResponse(processPayload(JSON.parse(options.body), {
    choose: (c, options) => c.categoryId === null ? options[0]?.id ?? 'none' : child && c.parentNoteId === null ? options[0]?.id ?? 'none' : 'none',
  })));
  await atlas.run(makeDigest('first','Tema inicial.',false)); child = true;
  await atlas.run(makeDigest('second','Aprofundamento do tema.',false));
  assert.equal(atlas.atlas.categories.length,1);
  assert.deepEqual(atlas.atlas.notes.map(n=>n.address),['A.1','A.1.A']);
  assert.equal(atlas.atlas.notes[1].parentNoteId,atlas.atlas.notes[0].id);
});

test('categoria existente vazia recebe nota .1 sem chamar criador de categorias', async t => {
  const { atlas } = await setup(t, async (_, options) => jsonResponse(processPayload(JSON.parse(options.body))));
  atlas.atlas.categories = [{ id: 'root', parentId: null, address:'A', name: 'Leads', description: 'Contatos.', noteIds: [] }];
  await atlas.save(); await atlas.run(makeDigest('leaf', 'Leads interessados.', false));
  assert.equal(atlas.atlas.categories.length, 1); assert.equal(atlas.atlas.categories[0].noteIds.length, 1);
  assert.equal(atlas.atlas.notes[0].address,'A.1');
});

test('erro parcial conserva Objeto P e notas concluídas; retry envia só o recorte pendente', async t => {
  let broken = true; const requests = [];
  const { atlas } = await setup(t, async (_, options) => {
    const p = JSON.parse(options.body); requests.push(p.blocks.map(b=>b.id));
    return jsonResponse(processPayload(p, { fail: b => broken && b.segmentId !== 'SEG_00001' }));
  });
  const digest = makeDigest();
  await assert.rejects(atlas.run(digest), /Falha no Jev/);
  assert.equal(atlas.atlas.noteIds.length, 1);
  const second = buildBlocks(digest)[1];
  assert.equal(JSON.parse(await readFile(atlas.blockPath(second.id), 'utf8')).text, second.text);
  broken = false; await atlas.run(digest);
  assert.deepEqual(requests.map(ids=>ids.length), [2,1]); assert.equal(atlas.atlas.noteIds.length, 2);
  assert.equal(atlas.atlas.categories.length, 1);
});

test('rejeita notas fora do pai, endereços duplicados e nomes de raiz duplicados', async t => {
  const { atlas } = await setup(t, async () => { throw new Error('Não chamar API'); });
  atlas.atlas.categories = [{id:'a',parentId:null,address:'A',name:'Tema',description:'Tema.',noteIds:[]},{id:'b',parentId:null,address:'B',name:' tema ',description:'Tema.',noteIds:[]}];
  assert.throws(()=>atlas.validateTree(),/mesmo nome/);
  const root={id:'a',parentId:null,address:'A',name:'Tema',description:'Tema.',noteIds:[]};
  assert.throws(()=>validateZettelTree([root],[{id:'n',title:'Nota',categoryId:'a',parentNoteId:'missing',address:'A.1.A'}]),/inexistente/);
  assert.throws(()=>validateZettelTree([root],[{id:'n',title:'Nota',categoryId:'a',parentNoteId:null,address:'B.1'}]),/diverge/);
  assert.throws(()=>validateZettelTree([root],[{id:'n',title:'Nota',categoryId:'a',parentNoteId:null,address:'A.1'},{id:'n2',title:'Outra',categoryId:'a',parentNoteId:null,address:'A.1'}]),/duplicado/);
});

test('executor adiciona Atlas às digestões antigas sem repetir LLM de digestão', async t => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-migration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = new Executor(root, { digestWebhook: 'http://example.invalid/digest' }, { log() {} });
  await legacy.initialize();
  const digest = makeDigest('legacy', 'Conhecimento anterior.', false);
  await writeJson(join(root, 'Digestões', 'legacy.json'), digest);
  legacy.state.jobs.push({ id: 'legacy', status: 'completed', sequence: 1, digestFile: 'Digestões/legacy.json', inputName: 'legacy.txt', baseName: 'legacy' });
  await legacy.save();
  const updated = new Executor(root, { ...config, digestWebhook: 'http://example.invalid/digest', stableForMs: 1 }, { log() {}, request: async (url, options) => {
    assert.equal(url, config.atlasWebhook);
    const p = JSON.parse(options.body);
    return jsonResponse(processPayload(p, { accepted: false }));
  } });
  await updated.initialize();
  await updated.batch();
  assert.equal(updated.state.jobs[0].status, 'completed');
  assert.equal(updated.state.jobs[0].atlasStatus, 'completed');
});

test('endereços de irmãos, letras após Z e múltiplos níveis são sequenciais e estáveis', () => {
  assert.equal(letterAddress(27),'AA');
  let tree=[{id:'a',parentId:null,address:'A',name:'Tema',description:'Tema.',noteIds:[]}],noteTree=[];
  let parentNoteId=null;
  for(let i=0;i<6;i++){
    const block={...buildBlocks(makeDigest('deep-'+i,'Um tema.',false))[0],title:'Ideia '+i,status:'prepared'};
    const c=insertZettelNote({tree,noteTree,categoryId:'a',parentNoteId,block});noteTree=c.noteTree;parentNoteId=block.id;
  }
  assert.deepEqual(noteTree.map(n=>n.address),['A.1','A.1.A','A.1.A.1','A.1.A.1.A','A.1.A.1.A.1','A.1.A.1.A.1.A']);
  validateZettelTree(tree,noteTree);
  const sibling=insertZettelNote({tree,noteTree,categoryId:'a',parentNoteId:noteTree[0].id,block:{...buildBlocks(makeDigest('sibling','Um tema.',false))[0],title:'Outra'}});
  assert.equal(sibling.block.address,'A.1.B');
});

test('nome da nota contém endereço, contagem e título e cabe no Windows/Linux', () => {
  assert.equal(zettelFilename({address:'A.1',wordCount:150,title:'A distinção entre artistas e especialistas'}),'A.1 - 150 palavras - A distinção entre artistas e especialistas.md');
  const name=zettelFilename({address:'B.2.A',wordCount:250,title:'Tema / com: símbolos? 🧠 '.repeat(20)});
  assert.ok(Buffer.byteLength(name)<255);assert.ok(!/[\\/:*?"<>|]/.test(name));assert.ok(!name.includes('\uFFFD'));
});

test('migra árvore antiga conservando recortes, backup e IDs; índice só tem títulos', async t => {
  const root=await mkdtemp(join(tmpdir(),'atlas-zettel-migration-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await import('node:fs/promises').then(({mkdir})=>Promise.all(['Atlas/Recortes','Atlas/Notas'].map(f=>mkdir(join(root,f),{recursive:true}))));
  const block=note(buildBlocks(makeDigest('legacy-zettel','  Recorte literal com espaços.  ',false))[0]).block;
  block.status='accepted';block.categoryId='sub';
  await writeJson(join(root,'Atlas','Recortes',block.id+'.json'),block);
  const oldName=readableName(block.title,block.createdAt,`${block.sourceId} — ${block.segmentId}`)+'.md';
  await writeFile(join(root,'Atlas','Notas',oldName),'# Nota antiga\nOrigem: metadata\n'+block.text);
  await writeJson(join(root,'Atlas','atlas.json'),{id:'atlas-id',createdAt:block.createdAt,updatedAt:block.updatedAt,schemaVersion:1,categories:[{id:'root',parentId:null,name:'Marketing',description:'Domínio.',noteIds:[]},{id:'sub',parentId:'root',name:'Subcategoria',description:'Detalhe.',noteIds:[block.id]}],noteIds:[block.id]});
  const atlas=new AtlasProcessor(root,config,{request:()=>{throw new Error('Sem IA para migrar');},log(){}});
  await atlas.initialize();await atlas.initialize();
  assert.equal(atlas.atlas.id,'atlas-id');assert.equal(atlas.atlas.categories.length,1);assert.equal(atlas.atlas.notes[0].id,block.id);assert.equal(atlas.atlas.notes[0].address,'A.1');
  assert.equal(await readFile(join(root,'Atlas','Notas','A.1 - 4 palavras - Uma ideia útil.md'),'utf8'),block.text);
  assert.equal(await readFile(join(root,'Atlas','Atlas de Conhecimento.md'),'utf8'),'# A. Marketing\n\n## A.1 Uma ideia útil\n');
  assert.equal(JSON.parse(await readFile(join(root,'Atlas','Backup anterior ao Zettelkasten','atlas.json'),'utf8')).schemaVersion,1);
  assert.deepEqual(await readdir(join(root,'Atlas','Notas')),['A.1 - 4 palavras - Uma ideia útil.md']);
});


test('conta palavras do recorte e renomeia nota existente ao iniciar sem IA ou duplicação', async t => {
  let calls = 0;
  const { root, atlas } = await setup(t, async (_, options) => {
    calls++; return jsonResponse(processPayload(JSON.parse(options.body)));
  });
  const text = '  Olá,\t mundo!\n\nMais uma ideia.  ';
  await atlas.run(makeDigest('word-count', text, false));
  const saved = atlas.atlas.notes[0];
  assert.equal(saved.wordCount, 5);
  assert.equal(saved.noteFile, 'A.1 - 5 palavras - Uma ideia útil.md');
  assert.equal(await readFile(join(root, 'Atlas', 'Notas', saved.noteFile), 'utf8'), text);
  const index = await readFile(join(root, 'Atlas', 'Atlas de Conhecimento.md'), 'utf8');
  const oldName = 'A.1 - Uma ideia útil.md';
  await import('node:fs/promises').then(({ rename }) => rename(join(root, 'Atlas', 'Notas', saved.noteFile), join(root, 'Atlas', 'Notas', oldName)));
  saved.noteFile = oldName; delete saved.wordCount; await atlas.save();
  await atlas.initialize(); await atlas.initialize();
  assert.equal(calls, 1);
  assert.equal(atlas.atlas.notes[0].wordCount, 5);
  assert.deepEqual(await readdir(join(root, 'Atlas', 'Notas')), ['A.1 - 5 palavras - Uma ideia útil.md']);
  assert.equal(await readFile(join(root, 'Atlas', 'Notas', atlas.atlas.notes[0].noteFile), 'utf8'), text);
  assert.equal(await readFile(join(root, 'Atlas', 'Atlas de Conhecimento.md'), 'utf8'), index);
});
