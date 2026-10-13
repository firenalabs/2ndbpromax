import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildModular} from '../workflows/build-modular.mjs';
import {organizeAtlas} from '../workflows/atlas-organizado.mjs';
import {segmentText} from '../contratos.mjs';
import {buildBlocks} from '../contratos-atlas.mjs';
const find=(w,name)=>w.nodes.find(n=>n.name===name);
const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-13T12:00:00Z']));}};
function run(code,value,context){return JSON.parse(JSON.stringify(vm.runInNewContext('(function(){'+code+'\n})()',{
  $input:{first:()=>({json:structuredClone(value)})},$:(name)=>({item:{json:structuredClone(context)}}),Date:fixedDate,
})));}
function material(){
  const text='Um conceito pode ser explicado. Um segundo ponto complementa a ideia.';
  const segmentation=segmentText(text);
  const digest={id:'source-digest',sourceId:'source',createdAt:'2026-10-13T12:00:00Z',updatedAt:'2026-10-13T12:00:00Z',originalText:text,segmentation,
    segmentedText:segmentation.segments.map(s=>'['+s.id+'] '+text.slice(s.start,s.end).trim()).join('\n'),keytopics:[{id:'SEG_00001',title:'Conceito',bulletpoints:['Um ponto.']}]};
  const block={...buildBlocks(digest)[0],title:'Nota sobre conceito',status:'prepared',routingDecisions:[]};
  return {digest,block};
}

test('Atlas organizado conserva chamadas, regras, loops e conexões de modelos',async()=>{
  const before=(await buildModular({atlasLayout:false})).atlas,after=organizeAtlas(before);
  assert.equal(before.nodes.length-after.nodes.length,1);
  const names=new Set(after.nodes.map(n=>n.name));
  assert.ok(names.has('Processar cada recorte'));assert.ok(names.has('Preparar recortes recebidos'));
  for(const n of after.nodes){
    const old=find(before,n.name==='Preparar recortes recebidos'?'Cortar texto deterministicamente':n.name);
    if(n.type==='n8n-nodes-base.code')new Function('$input','$','$runIndex',n.parameters.jsCode);
    else if(!n.type.endsWith('stickyNote'))assert.deepEqual(n.parameters,old.parameters);
    for(const field of ['onError','retryOnFail','maxTries','waitBetweenTries','alwaysOutputData','executeOnce'])assert.equal(n[field],old[field]);
    for(const m of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g))assert.ok(names.has(m[1]),m[1]);
  }
  for(const[source,channels]of Object.entries(before.connections))for(const[type,batches]of Object.entries(channels)){
    if(type!=='main')assert.deepEqual(after.connections[source][type],batches);
    else if(source!=='Preparar categoria raiz'){
      const actualSource=source==='Cortar texto deterministicamente'?'Preparar recortes recebidos':source;
      const expected=batches.map(batch=>batch.map(e=>({...e,node:e.node==='Cortar texto deterministicamente'?'Preparar recortes recebidos':e.node==='Preparar categoria raiz'?'Agent: Criador de Categorias':e.node})));
      assert.deepEqual(after.connections[actualSource].main,expected,source);
    }
  }
  for(const channels of Object.values(after.connections))for(const e of Object.values(channels).flat(2))assert.ok(names.has(e.node));
  assert.deepEqual(organizeAtlas(after),after);
});

test('limpeza da validação do Atlas conserva aceitação e rejeição dos pedidos',async()=>{
  const before=(await buildModular({atlasLayout:false})).atlas,after=organizeAtlas(before),{digest,block}=material();
  const valid={operation:'process',atlasSchemaVersion:2,knowledgeThreshold:.8,digest,blocks:[block],categories:[],notes:[]};
  const scenarios=[valid,{...valid,knowledgeThreshold:2},{...valid,operation:'errada'},{...valid,blocks:[{...block,text:'Alterado'}]},
    {...valid,blocks:[block,block]}, {...valid,digest:{...digest,id:'errado'}},{...valid,notes:[{id:'n',categoryId:'inexistente'}]}];
  for(const value of scenarios)assert.deepEqual(run(find(after,'Validar pedido do Atlas').parameters.jsCode,value),run(find(before,'Validar pedido do Atlas').parameters.jsCode,value));
});

test('limpeza das funções preserva criação de raiz, posições, descendência e erros',async()=>{
  const before=(await buildModular({atlasLayout:false})).atlas,after=organizeAtlas(before),{block}=material();
  const category={id:'root',parentId:null,name:'Conceitos',description:'Conceitos gerais.',address:'A',noteIds:[]};
  const note={id:'note',categoryId:'root',parentNoteId:null,title:'Nota anterior',address:'A.1'};
  const base={block,tree:[category],noteTree:[note],categoryId:null,parentNoteId:null,ancestors:[],ok:true,decision:null};
  const contexts=[{...base,tree:[],noteTree:[]},base,{...base,categoryId:'root'}, {...base,tree:[{...category,id:block.id+'-category-root-v2'}]}];
  for(const context of contexts)for(const output of [{path:[{name:'Nova raiz',description:'Descrição da raiz.'}]},{path:[{name:'Conceitos',description:'Raiz existente.'}]},{path:[]},{path:[{name:'',description:''}]}]){
    const value={output};assert.deepEqual(run(find(after,'Validar categoria raiz e posicionar nota').parameters.jsCode,value,context),run(find(before,'Validar categoria raiz e posicionar nota').parameters.jsCode,value,context));
  }
  const cases=[{...base,action:'select',decision:{choice:'root'}},{...base,action:'select',decision:{choice:'missing'}},
    {...base,action:'select',decision:{choice:'root'},ancestors:[{id:'root'}]},
    {...base,categoryId:'root',action:'insert',decision:null},
    {...base,categoryId:'root',action:'select',decision:{choice:'note'}},
    {...base,categoryId:'root',parentNoteId:'note',action:'insert',decision:{choice:'none'}},
    {...base,ok:false,errorMessage:'Erro anterior'},
    {...base,categoryId:'root',action:'insert',decision:null,noteTree:[{...note,id:block.id}]}];
  for(const value of cases)assert.deepEqual(run(find(after,'Avançar ou posicionar nota').parameters.jsCode,value),run(find(before,'Avançar ou posicionar nota').parameters.jsCode,value));
});
