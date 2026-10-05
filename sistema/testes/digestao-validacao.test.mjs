import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const specs=JSON.parse(await readFile(new URL('../workflows/01-digestao.nodes.json',import.meta.url),'utf8'));
const sourceId='00000000-0000-4000-8000-000000000001';
function fixture(){
 const body={sourceId,digestId:sourceId+'-digest-v1',createdAt:'2026-10-05T00:00:00Z',text:'Introdução ao podcast. Uma primeira ideia. Outra explicação.'};
 return new Function('$input',specs[1].parameters.jsCode)({first:()=>({json:{body}})})[0].json;
}
function runValidator(source,keytopics,index=5){
 return new Function('$input','$',specs[index].parameters.jsCode)({first:()=>({json:{output:{keytopics}}})},()=>({first:()=>({json:source})}))[0].json;
}
const topic=id=>({id,title:'Ideia',bulletpoints:['Uma ideia do texto.']});
for(const [label,ids,pattern] of [
 ['primeiro SEG ausente',['SEG_00002'],/primeiro KeyTopic.*SEG_00002.*SEG_00001/],
 ['ID inexistente',['SEG_00001','SEG_99999'],/inexistente/],
 ['ID duplicado',['SEG_00001','SEG_00001'],/repetido ou fora de ordem/],
 ['fora de ordem',['SEG_00001','SEG_00003','SEG_00002'],/repetido ou fora de ordem/],
])test('digestão diagnostica limites inválidos: '+label,()=>{
 const source=fixture(),invalid=runValidator(source,ids.map(topic));
 assert.equal(invalid.ok,false);assert.match(invalid.error.message,pattern);
 const corrected=runValidator(source,['SEG_00001','SEG_00003'].map(topic));
 assert.equal(corrected.ok,true);assert.equal(corrected.originalText,source.text);
 assert.equal(corrected.sourceId,sourceId);
});
