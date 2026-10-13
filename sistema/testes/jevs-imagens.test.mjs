import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{buildModular}from'../workflows/build-modular.mjs';import{fixImageJevBodies}from'../workflows/jevs-imagens-validos.mjs';
const evaluate=(body,value)=>{const output=new Function('$json','return ('+body.slice(3,-2).trim()+');')(value);return typeof output==='string'?JSON.parse(output):output;};
test('três Jevs de imagens preservam integralmente o pedido e não têm fechamento prematuro de expressão',async()=>{
 const original=JSON.parse(await readFile(new URL('../workflows/modular-originais.json',import.meta.url)));
 const w=fixImageJevBodies(original.test);let changed=0;
 for(const n of w.nodes){
  const old=original.test.nodes.find(v=>v.name===n.name);
  if(n.parameters.jsonBody===old.parameters.jsonBody){assert.deepEqual(n,old);continue;}
  changed++;assert.deepEqual({...n,parameters:{...n.parameters,jsonBody:old.parameters.jsonBody}},old);
  assert.equal(n.parameters.jsonBody.slice(3,-2).includes('}}'),false);
  for(const value of [{part:'Texto "com aspas" 🚀\nNova linha.',baseText:'outra',text:'original',texto:'alternativo'},{baseText:'Base'},{text:'Original'},{texto:'Alternativo'},{part:'',baseText:'Base'}])assert.deepEqual(evaluate(n.parameters.jsonBody,value),evaluate(old.parameters.jsonBody,value));
 }
 assert.equal(changed,3);assert.deepEqual(w.connections,original.test.connections);assert.deepEqual(fixImageJevBodies(w),w);
 const generated=(await buildModular()).generation;
 assert.equal(generated.nodes.filter(n=>n.type.endsWith('httpRequest')&&n.name.includes('google imagens')&&n.parameters.jsonBody.startsWith('={{ JSON.stringify(')).length,3);
});
