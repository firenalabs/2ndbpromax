import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildModular } from '../workflows/build-modular.mjs';
import { editorialAdapters, simplifyEditorial } from '../workflows/simplificar-editorial.mjs';

const fixedDate = class extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-13T12:00:00Z'])); }
};
function run(code, items, context) {
  const value = vm.runInNewContext('(function(){' + code + '\n})()', {
    $input: { all: () => structuredClone(items), first: () => structuredClone(items[0]) },
    $: () => ({ itemMatching: () => ({json: structuredClone(context)}), first: () => ({json: structuredClone(context)}) }),
    $runIndex: 0, Date: fixedDate,
  });
  return JSON.parse(JSON.stringify(value));
}
const node = (w, name) => w.nodes.find(n => n.name === name);
const context = { text:'Texto original', texto:'Texto original', referenceId:'source:block', groupId:'group', sourceIds:['source'],
  contentTitle:'Título', contentSourceIds:['source'], contentIndex:1, sourceWordCount:350, threshold:.8,
  partsOutput:{parts:['Slide 1','Slide 2']}, parts:['Parte 1','Parte 2'], partIndex:0, firstPart:'Parte 1',
  baseText:'Um post', output:{parts:['Parte 1','Parte 2']}, stageErrors:[], decision:{accepted:true}, imageDecision:{accepted:false} };

test('simplificação conserva configuração de chamadas, layout e todas as rotas', async () => {
  const before = (await buildModular({simplify:false,centralize:false})).generation;
  const after = simplifyEditorial(before);
  const names = new Set(after.nodes.map(n => n.name));
  assert.equal(before.nodes.length-after.nodes.length,16);
  assert.equal(after.nodes.length,187);
  for (const n of after.nodes) {
    const old = node(before,n.name);
    assert.deepEqual(n.position,old.position);
    if (n.type !== 'n8n-nodes-base.code') assert.deepEqual(n,old);
    else {
      const {jsCode,...p} = n.parameters, {jsCode:_,...oldP} = old.parameters;
      assert.deepEqual(p,oldP);
      new Function('$input','$','$runIndex',jsCode);
    }
    for (const match of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
      // Coletor legado tolera explicitamente nodes ausentes do antigo teste.
      if (n.name !== 'Ver todos os outputs dos Agents') assert.ok(names.has(match[1]),match[1]);
    }
  }
  const resolve = edge => names.has(edge.node) ? [edge] : before.connections[edge.node].main[0].flatMap(resolve);
  for (const [source,c] of Object.entries(before.connections)) {
    if (!names.has(source)) continue;
    const expected = structuredClone(c);
    if (expected.main) expected.main = expected.main.map(batch=>batch.flatMap(resolve));
    assert.deepEqual(after.connections[source],expected,source);
  }
  for (const c of Object.values(after.connections)) for (const e of Object.values(c).flat(2)) assert.ok(names.has(e.node));
  assert.deepEqual(simplifyEditorial(after),after);
});

test('helpers limpos e referências substituídas conservam posts, erros e pareamento', async () => {
  const before = (await buildModular({simplify:false,centralize:false})).generation, after=simplifyEditorial(before);
  const scenarios = [
    [{json:{output:JSON.stringify({parts:['Parte 1','Parte 2'],text:'Ensaio',posts:[{text:'A'},{text:'B'}]}), answers:{tutorial:{type:'noul',noul:.9},checklist:{type:'noul',noul:.9},lista:{type:'noul',noul:.9},imagem:{type:'noul',noul:.9}}}}],
    [{json:{output:'Texto simples',answers:{imagem:{type:'noul',noul:.1}}}}, {json:{output:'Outro texto'}}],
    [{json:{output:'```json\n{"posts":[{"text":"A"},{"text":"B"}]}\n```'}}],
    [{json:{output:{parts:'inválido'},answers:{imagem:{type:'noul',noul:2}}}}],
    [{json:{error:{message:'Falha do provedor'}}}],
  ];
  let tested=0;
  for (const n of after.nodes.filter(n=>n.type==='n8n-nodes-base.code')) {
    const old=node(before,n.name);
    if (old.parameters.jsCode===n.parameters.jsCode || /Ver todos|Contar palavras|Conferir cache/.test(n.name)) continue;
    for (const items of scenarios) assert.deepEqual(run(n.parameters.jsCode,items,context),run(old.parameters.jsCode,items,context),n.name);
    tested++;
  }
  assert.ok(tested>=16);
});

test('faixas unidas à contagem conservam metadados nos limites e fora deles', async () => {
  const before=(await buildModular({simplify:false,centralize:false})).generation,after=simplifyEditorial(before);
  const bands=['0 a 100','101 a 200','201 a 400','401 a 800','801 a 1600','1601 a 3200','3200+'];
  for (const words of [0,1,100,101,200,201,400,401,800,801,1600,1601,3200,3201]) {
    const input=[{json:{...context,block:{id:'cut',text:Array(words).fill('palavra').join(' ')}}}];
    const old=run(node(before,'Contar palavras para conteúdo — Diário1').parameters.jsCode,input,context);
    const i=[100,200,400,800,1600,3200,Infinity].findIndex(limit=>words<=limit);
    const expected=run(node(before,bands[i]).parameters.jsCode,old,context);
    const result=run(node(after,'Contar palavras para conteúdo — Diário1').parameters.jsCode,input,context);
    assert.deepEqual(result,expected,String(words));
  }
});

test('adaptadores de texto unidos ao cache conservam dados e retomada por execução', async () => {
  const before=(await buildModular({simplify:false,centralize:false})).generation,after=simplifyEditorial(before);
  for (const [removed,next] of Object.entries(editorialAdapters)) {
    const input=[{json:{...context,texto:'Valor anterior'}},{json:{...context,text:'Texto dois'}}];
    for (const cache of [{}, {0:[{output:'Resposta salva'}]}, {1:[{output:'Outra execução'}]}]) {
      const stage=next.replace('Conferir cache — ','');
      const ctx={...context,cache:{[stage]:cache}};
      const adapted=run(node(before,removed).parameters.jsCode,input,ctx);
      const expected=run(node(before,next).parameters.jsCode,adapted,ctx);
      assert.deepEqual(run(node(after,next).parameters.jsCode,input,ctx),expected,removed);
    }
  }
});
