import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildModular} from '../workflows/build-modular.mjs';
import {diaryWithoutLoop} from '../workflows/diario-sem-loop.mjs';
const keys=['victory','obstacle','story','gratitude','joke','personalLife'];
const find=(w,name)=>w.nodes.find(n=>n.name===name);
const exec=(code,input,lookup)=>new Function('$input','$',code)({all:()=>input,first:()=>input[0]},lookup);

test('Diário sem loop conserva agentes, modelos, schemas, Jevs e todos os caminhos',async()=>{
  const original=JSON.parse(await readFile(new URL('../workflows/modular-originais.json',import.meta.url)));
  const w=(await buildModular({bragSegments:false})).diary;
  assert.equal(w.nodes.some(n=>n.type==='n8n-nodes-base.splitInBatches'),false);
  for(const n of w.nodes.filter(n=>/\.agent$|lmChat|outputParser|httpRequest/.test(n.type))){
    const old=find(original.diary,n.name);assert.deepEqual(n.parameters,old.parameters);assert.equal(n.onError,old.onError);
  }
  const names=new Set(w.nodes.map(n=>n.name));
  for(const n of w.nodes)for(const m of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g))assert.ok(names.has(m[1]),m[1]);
  const visiting=new Set(),done=new Set();
  function visit(name){if(done.has(name))return;assert.ok(!visiting.has(name),'ciclo: '+name);visiting.add(name);for(const e of w.connections[name]?.main?.flat()??[]){assert.ok(names.has(e.node));visit(e.node);}visiting.delete(name);done.add(name);}
  for(const name of names)visit(name);
  const jevs=w.connections['Pedido válido?'].main[0];assert.equal(jevs.length,6);
  assert.equal(find(w,'Aguardar as seis avaliações Jev').parameters.numberInputs,6);
  assert.deepEqual(jevs.map(e=>w.connections[e.node].main[0][0].index),[0,1,2,3,4,5]);
  assert.equal(w.connections['Rotear aspectos true'].main.length,7);
  assert.equal(w.nodes.filter(n=>n.name.endsWith('conectar ação aqui')).length,5);
  assert.deepEqual(diaryWithoutLoop(w),w);
});

test('64 combinações de aspectos aguardam todos os resultados e respondem uma única vez',async()=>{
  const w=(await buildModular()).diary;
  const prepare=find(w,'Preparar ações dos aspectos true').parameters.jsCode;
  const final=find(w,'Montar Diário e Conquistas completos').parameters.jsCode;
  const original=JSON.parse(await readFile(new URL('../workflows/modular-originais.json',import.meta.url)));
  const oldFinal=find(original.diary,'Montar Diário e Conquistas completos').parameters.jsCode;
  for(let mask=0;mask<64;mask++)for(const reverse of [false,true]){
    const context={aspects:{flags:Object.fromEntries(keys.map((k,i)=>[k,!!(mask&(1<<i))])),decisions:{}},diary:{title:'Registro',summary:'Resumo'},errors:{}};
    const actions=exec(prepare,[{json:context}],()=>{});
    assert.ok(actions.every(item=>item.pairedItem.item===0));
    const order=reverse?[...actions].reverse():actions;
    const runs=[];
    const lookup=name=>name==='Validar título e resumo'?{first:()=>({json:context})}:{all:(_,run)=>{if(!runs[run])throw Error('não executado');return runs[run];}};
    for(let i=0;i<order.length;i++){
      const item=structuredClone(order[i]);if(item.json.aspect==='victory')item.json.achievements=[{evento:'Conquista'}];
      runs.push([item]);const result=exec(final,[item],lookup);
      if(i<order.length-1)assert.deepEqual(result,[],String(mask));
      else assert.deepEqual(result,exec(oldFinal,[...runs.flat()].sort((a,b)=>keys.indexOf(a.json.aspect)-keys.indexOf(b.json.aspect)),()=>{}),String(mask));
    }
    // Montagens que tenham sido enfileiradas antes da última ação não duplicam a resposta.
    for(const item of order.slice(0,-1))assert.deepEqual(exec(final,[item],lookup),[]);
  }
});

test('conserva resultado parcial e erros de Diário/Brag, sem perder outros aspectos',async()=>{
  const w=(await buildModular()).diary;
  const context={text:'Original',aspects:{flags:Object.fromEntries(keys.map(k=>[k,true])),decisions:{}},diary:null,errors:{diary:'Falha no diário'}};
  const actions=exec(find(w,'Preparar ações dos aspectos true').parameters.jsCode,[{json:context}],()=>{});
  const registrar=find(w,'Registrar resultado da ação').parameters.jsCode;
  const runs=actions.map(action=>exec(registrar,[{json:action.json.aspect==='victory'?{errors:{brag:'Falha Brag'}}:action.json}],()=>({itemMatching:()=>action})));
  const lookup=name=>name==='Validar título e resumo'?{first:()=>({json:context})}:{all:(_,i)=>{if(!runs[i])throw Error('fim');return runs[i];}};
  const result=exec(find(w,'Montar Diário e Conquistas completos').parameters.jsCode,runs.at(-1),lookup)[0].json;
  assert.deepEqual(result.errors,{diary:'Falha no diário',brag:'Falha Brag'});
  assert.equal(result.actionResults.length,6);assert.equal(result.actionResults[0].status,'failed');
  assert.deepEqual(result.achievements,[]);
});
