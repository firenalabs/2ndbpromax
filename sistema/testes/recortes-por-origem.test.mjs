import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cutsByOrigin,assertSingleCutOrigin} from '../recortes-por-origem.mjs';
import {EditorialGeneration} from '../geracao-editorial.mjs';
import {segmentText} from '../contratos.mjs';
import {saveMaterials} from '../materiais.mjs';
import {writeJson} from '../arquivos.mjs';

const cut=(parent,index)=>({id:parent+'-'+index,kind:'recorte',sourceId:parent,digestId:parent+'-digest',sourceIds:[parent],digestIds:[parent+'-digest'],inputFiles:['Originais/'+parent+'.txt'],inputName:parent+'.txt',keytopic:'Assunto '+index,text:parent+' texto '+index});
const output=(text)=>({contents:[{contentKey:'post:0:0',contentType:'opiniao',title:'Título',parts:[text],destinations:[{platform:'Twitter',format:'single_text'}]}],errors:[],cache:{Agent:{0:[{output:{text}}]}},workflowId:'wf',executionId:'exec'});
async function rootFor(t){const root=await mkdtemp(join(tmpdir(),'recortes-origem-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'sistema'));return root;}
function generation(root,request=async()=>{throw new Error('Não deve chamar IA')}){return new EditorialGeneration(root,{generationWebhook:'https://example.invalid'}, {request,log(){}});}

test('agrupamento exige IDs do insumo e digestão; nomes iguais não fundem origens',()=>{
  const a=cut('A',1),b={...cut('B',1),inputName:'A.txt'};
  assert.equal(cutsByOrigin([a,b,cut('A',2)]).length,2);
  assert.throws(()=>assertSingleCutOrigin([a,b]),/único insumo/);
  assert.throws(()=>cutsByOrigin([{...a,sourceIds:['A','B']}]),/única origem/);
  assert.throws(()=>cutsByOrigin([{...a,digestIds:['errado']}]),/única origem/);
  const revision={...a,id:'A-revisão',digestId:'outro',digestIds:['outro']};
  assert.equal(cutsByOrigin([a,revision]).length,2);
});

test('opção 2 cria pedido por insumo e executa cada recorte separadamente',async t=>{
  const root=await rootFor(t);
  for(const id of ['A','B']) {
    const text=id+' assunto um. '+id+' assunto dois.',segmentation=segmentText(text);
    await saveMaterials(root,{id:id+'-digest',sourceId:id,originalText:text,sourceFile:'Originais/'+id+'.txt',inputName:'mesmo-nome.txt',createdAt:'2026-10-13T12:00:00Z',updatedAt:'2026-10-13T12:00:00Z',schemaVersion:1,segmentation,
      segmentedText:segmentation.segments.map(s=>'['+s.id+'] '+text.slice(s.start,s.end).trim()).join('\n'),
      keytopics:segmentation.segments.map((s,i)=>({id:s.id,title:'Assunto '+i,bulletpoints:['Ponto']}))},id);
  }
  const calls=[];const g=generation(root,async(_,options)=>{const p=JSON.parse(options.body);calls.push(p);return {ok:true,json:async()=>output(p.source.text)};});
  await g.initialize();await g.runCuts();
  assert.equal(g.state.batches.length,2);assert.equal(calls.length,4);
  for(const batch of g.state.batches) {
    assert.equal(batch.sources.length,2);assert.ok(batch.sources.every(s=>s.sourceId===batch.origin.sourceId));
    const sent=calls.filter(p=>p.generationBatchId===batch.id);assert.equal(sent.length,2);
    assert.ok(sent.every(p=>p.source.sourceIds[0]===batch.origin.sourceId));
    const pedido=JSON.parse(await readFile(join(root,'Conteúdos Gerados',batch.folder,'pedido.json')));
    assert.equal(pedido.origin.sourceId,batch.origin.sourceId);assert.match(batch.folder,/mesmo-nome/);
    const index=await readFile(join(root,'Conteúdos Gerados',batch.folder,'índice.md'),'utf8');assert.match(index,/Insumo original: mesmo-nome.txt/);
  }
  assert.notEqual(g.state.batches[0].folder,g.state.batches[1].folder);
  await g.runCuts();assert.equal(calls.length,4);
  await assert.rejects(g.createBatch('recortes',[cut('A',1),cut('B',1)]),/único insumo/);
});

async function mixedBatch(root) {
  const g=generation(root);await g.initialize();
  const sources=[cut('A',1),cut('B',1),cut('A',2)];
  const batch={id:'old-batch',kind:'recortes',createdAt:'2026-10-13T12:00:00Z',status:'partial',folder:'gen-antigo-misturado',sources,records:[]};
  g.state.batches.push(batch);await g.manifest(batch);
  for(const [i,source]of sources.entries()) {
    const unit={id:'unit-'+source.id,batchId:batch.id,source,status:source.id==='A-2'?'partial':'completed',code:'R0'+(i+1),files:[],cache:{saved:{0:[{output:source.text}]}},errors:source.id==='A-2'?[{message:'Falha antiga'}]:[]};
    g.state.units['recorte:'+source.id]=unit;
    const result=output(source.text);
    await g.writeContents(batch,unit,result.contents,result);
    await writeJson(join(root,'Conteúdos Gerados',batch.folder,'Fontes',unit.code+'-execucao.json'),result);
  }
  await g.save();return {g,batch,sources};
}

test('separa pedido antigo misturado, preserva conteúdo, códigos, status e cache sem IA',async t=>{
  const root=await rootFor(t),{batch,sources}=await mixedBatch(root);
  const g=generation(root);await g.initialize();assert.equal(g.state.batches.length,2);
  assert.equal(g.state.originMigrations[0].archived,true);
  await assert.rejects(readFile(join(root,'Conteúdos Gerados',batch.folder,'pedido.json')),{code:'ENOENT'});
  const archive=join(root,'Conteúdos Gerados','Histórico de pedidos reorganizados',batch.folder);
  assert.match(await readFile(join(archive,'PEDIDO REORGANIZADO.md'),'utf8'),/A.txt/);
  const backup=JSON.parse(await readFile(join(archive,'estado-original-antes-da-separação.json')));
  assert.equal(backup.batch.sources.length,3);
  for(const source of sources) {
    const unit=g.state.units['recorte:'+source.id],child=g.state.batches.find(b=>b.id===unit.batchId);
    assert.equal(child.origin.sourceId,source.sourceId);assert.deepEqual(unit.cache,{saved:{0:[{output:source.text}]}});
    assert.equal(unit.status,source.id==='A-2'?'partial':'completed');
    assert.equal(unit.originalGenerationBatchId,batch.id);
    const directory=join(root,'Conteúdos Gerados',child.folder);
    assert.match(await readFile(join(root,'Conteúdos Gerados',unit.publicFiles.find(e=>e.contentType==='opiniao').contentFile),'utf8'),new RegExp(source.text));
    const metadata=JSON.parse(await readFile(join(root,'Conteúdos Gerados',unit.publicFiles.find(e=>e.contentType==='opiniao').metadataFile)));
    assert.equal(metadata.generationBatchId,child.id);assert.equal(metadata.originalGenerationBatchId,batch.id);
    assert.equal(child.sourceCodes[source.id],unit.code);
  }
  const resumed=[];g.request=async(_,o)=>{const p=JSON.parse(o.body);resumed.push(p);return {ok:true,json:async()=>output(p.source.text)};};
  for(const b of g.state.batches.filter(b=>b.status!=='completed'))await g.executeBatch(b);
  assert.equal(resumed.length,1);assert.equal(resumed[0].source.id,'A-2');assert.deepEqual(resumed[0].cache,{saved:{0:[{output:'A texto 2'}]}});
  const again=generation(root);await again.initialize();assert.equal(again.state.batches.length,2);assert.equal(again.state.originMigrations.length,1);
});

test('interrupção da separação reutiliza o plano e não cria pedidos duplicados',async t=>{
  const root=await rootFor(t),{g,batch}=await mixedBatch(root);
  const save=g.save.bind(g);let interrupted=false;
  g.save=async()=>{await save();if(!interrupted&&batch.originSplitPlan){interrupted=true;throw new Error('Interrupção simulada depois de persistir o plano');}};
  await assert.rejects(g.isolateCutBatches(),/Interrupção simulada/);
  const ids=batch.originSplitPlan.map(b=>b.id);
  const resumed=generation(root);await resumed.initialize();assert.deepEqual(resumed.state.batches.map(b=>b.id),ids);
  await resumed.initialize();assert.deepEqual(resumed.state.batches.map(b=>b.id),ids);
});

test('proteção de execução rejeita pedido com duas origens antes de qualquer chamada',async t=>{
  const root=await rootFor(t),g=generation(root);await g.initialize();
  await assert.rejects(g.executeBatch({kind:'recortes',sources:[cut('A',1),cut('B',1)]}),/único insumo/);
  assert.equal((await readdir(join(root,'Conteúdos Gerados','Pedidos'))).length,0);
});
test('interrupção após associar os pedidos termina o arquivamento na próxima inicialização',async t=>{
  const root=await rootFor(t),{g,batch}=await mixedBatch(root);
  const finish=g.finishCutArchives.bind(g);
  g.finishCutArchives=async()=>{if(g.state.originMigrations?.length)throw new Error('Interrupção antes do arquivamento');await finish();};
  await assert.rejects(g.isolateCutBatches(),/antes do arquivamento/);
  const ids=g.state.batches.map(b=>b.id);
  const resumed=generation(root);await resumed.initialize();
  assert.deepEqual(resumed.state.batches.map(b=>b.id),ids);assert.equal(resumed.state.originMigrations[0].archived,true);
  for(const b of resumed.state.batches)assert.equal(JSON.parse(await readFile(join(root,'Conteúdos Gerados',b.folder,'pedido.json'))).origin.sourceId,b.origin.sourceId);
  assert.ok(await readFile(join(root,'Conteúdos Gerados','Histórico de pedidos reorganizados',batch.folder,'PEDIDO REORGANIZADO.md')));
});
