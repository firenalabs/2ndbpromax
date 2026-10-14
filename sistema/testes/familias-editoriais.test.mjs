import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {EditorialGeneration} from '../geracao-editorial.mjs';
import {familyFolder} from '../familias-editoriais.mjs';
import {writeJson} from '../arquivos.mjs';

const content=(key,type,text)=>({contentKey:key,contentType:type,title:'Título',parts:[text],caption:'Legenda-base',destinations:[{platform:'Twitter',format:'single_text'},{platform:'LinkedIn',format:'single_text'}]});
const source=(kind,id,ids)=>({kind,id,sourceId:ids[0],digestId:ids[0]+'-digest',sourceIds:ids,digestIds:ids.map(s=>s+'-digest'),inputFiles:ids.map(s=>'Originais/'+s+'.txt'),inputName:ids.length===1?ids[0]+'.txt':undefined,keytopic:'Assunto '+id,text:'Texto original '+ids.join(' + ')});
async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'familias-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'sistema'));
  const g=new EditorialGeneration(root,{}, {request:()=>{throw new Error('Não deve chamar IA');},log(){}});await g.initialize();return {root,g};
}
async function store(g,src,contents) {
  const batch=await g.createBatch(src.kind==='recorte'?'recortes':'diario',[src]);
  const unit={id:'unit-'+src.id,code:src.kind==='recorte'?'R01':'G01',source:src,batchId:batch.id,status:'completed',files:[],cache:{saved:{0:[{output:'Preservado'}]}},errors:[]};
  g.state.units[src.kind+':'+src.id]=unit;
  await g.writeContents(batch,unit,contents,{workflowId:'wf',executionId:'exec'});
  await writeJson(join(g.root,'Conteúdos Gerados',batch.folder,'Fontes',unit.code+'-execucao.json'),{contents,errors:[],cache:unit.cache,workflowId:'wf',executionId:'exec'});
  await g.manifest(batch);return {batch,unit};
}
const catalog=async(root,id)=>{const state=JSON.parse(await readFile(join(root,'sistema/geracoes.json')));const c=Object.values(state.collections).find(c=>c.sourceIds.includes(id)&&!state.collectionAliases[c.id]);return JSON.parse(await readFile(join(root,'Conteúdos Gerados',c.folder,'colecao.json')));};

test('coleção reúne tipos que chegam em momentos diferentes; grupo A+B consolida A e B',async t=>{
  const {root,g}=await setup(t);
  const cut=await store(g,source('recorte','cut-A',['A']),[content('quick','pensamento-rapido','Pensamento único A')]);
  assert.deepEqual(Object.keys((await catalog(root,'A')).types),['pensamento-rapido']);
  const group=await store(g,source('grupo','group-AB',['A','B']),[content('opinion','opiniao','Opinião única A+B')]);
  const a=await catalog(root,'A'),b=await catalog(root,'B');
  assert.deepEqual(Object.keys(a.types),['opiniao','pensamento-rapido']);assert.deepEqual(Object.keys(b.types),['opiniao','pensamento-rapido']);
  assert.equal(a.types.opiniao[0].publicationId,b.types.opiniao[0].publicationId);assert.equal(a.id,b.id);assert.deepEqual(a.sourceIds,['A','B']);
  assert.deepEqual(a.types.opiniao[0].sourceIds,['A','B']);
  assert.equal(a.types.opiniao[0].file,b.types.opiniao[0].file);
  assert.equal((await readdir(join(root,'Conteúdos Gerados','Coleções'))).filter(n=>n!=='aliases.json').length,1);
  assert.ok(await readFile(join(root,'Conteúdos Gerados',group.unit.publicFiles[0].contentFile)));
  assert.equal(cut.unit.id,'unit-cut-A');
  await g.initialize();assert.equal((await catalog(root,'A')).types.opiniao.length,1);
});

test('ensaios de recorte e de grupo permanecem distintos mesmo com o mesmo texto',async t=>{
  const {root,g}=await setup(t);
  await store(g,source('recorte','cut-A',['A']),[content('essay','ensaio','Mesmo texto integral')]);
  await store(g,source('grupo','group-A',['A']),[content('essay','ensaio','Mesmo texto integral')]);
  const refs=(await catalog(root,'A')).types.ensaio;
  assert.equal(refs.length,2);assert.notEqual(refs[0].publicationId,refs[1].publicationId);
  assert.deepEqual(refs.map(r=>r.materialKind),['recorte','grupo']);
});

test('migração de pedido diário com vários grupos preserva fontes, cache e saídas acumuladas sem IA',async t=>{
  const {root,g}=await setup(t),sources=[source('grupo','group-AB',['A','B']),source('grupo','group-C',['C'])];
  const batch={id:'old',kind:'diario',createdAt:'2026-10-14T00:15:00Z',status:'completed',folder:'gen-diario-antigo',sources,records:[]};g.state.batches.push(batch);
  const oldDirectory=join(root,'Conteúdos Gerados',batch.folder);await mkdir(join(oldDirectory,'Fontes'),{recursive:true});
  for(const[i,src]of sources.entries()) {
    const unit={id:'unit-'+src.id,code:'G0'+(i+1),batchId:batch.id,source:src,status:'completed',contentLayoutVersion:1,contentFolder:'G0'+(i+1)+' — assunto',files:['G0'+(i+1)+' — assunto/opiniao/conteudo.md'],cache:{saved:{0:[{output:'Não repetir'}]}},errors:[]};g.state.units['grupo:'+src.id]=unit;
    const directory=join(oldDirectory,unit.contentFolder,'opiniao');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'conteudo.md'),'Texto com revisão manual a preservar');
    await writeJson(join(directory,'metadados.json'),{generationId:unit.id,generationBatchId:batch.id});
    await writeJson(join(oldDirectory,'Fontes',unit.code+'-execucao.json'),{contents:[content('opinion','opiniao','Texto '+src.id),content('essay','ensaio','Ensaio '+src.id)],diagnostics:{outputsDosAgents:[],resultadosFinais:[],erros:[]},workflowId:'wf',executionId:'exec'});
  }
  await g.save();const hashes=JSON.stringify(Object.values(g.state.units).map(u=>[u.id,u.status,u.cache]));await g.initialize();
  assert.equal(JSON.stringify(Object.values(g.state.units).map(u=>[u.id,u.status,u.cache])),hashes);
  const current=g.state.batches.find(b=>b.id===batch.id);assert.equal(current.folder,'Pedidos/gen-diario-antigo');
  const a=await catalog(root,'A'),b=await catalog(root,'B'),c=await catalog(root,'C');
  assert.equal(a.types.ensaio.length,1);assert.equal(b.types.ensaio.length,1);assert.equal(c.types.ensaio.length,1);
  assert.notEqual(a.types.ensaio[0].publicationId,c.types.ensaio[0].publicationId);
  assert.equal((await readdir(join(root,'Conteúdos Gerados'))).some(f=>f.startsWith('gen-')),false);
  assert.equal(await readFile(join(root,'Conteúdos Gerados',current.folder,'Apresentação anterior','G01 — assunto/opiniao/conteudo.md'),'utf8'),'Texto com revisão manual a preservar');
  const fontes=await readFile(join(root,'Conteúdos Gerados',current.folder,'Fontes/G01.md'),'utf8');assert.match(fontes,/\.\.\/\.\.\/\.\.\/\.\.\/Originais\/A.txt/);
});

test('mudança de pasta de pedido se recupera após persistir o plano sem duplicar conteúdo',async t=>{
  const {root,g}=await setup(t),src=source('grupo','group-A',['A']);
  const batch={id:'old',kind:'diario',createdAt:'2026-10-14T00:15:00Z',folder:'gen-diario-antigo',status:'pending',sources:[src],records:[]};g.state.batches.push(batch);await g.manifest(batch);await g.save();
  const save=g.save.bind(g);let stop=false;g.save=async()=>{await save();if(batch.requestFolderMove&&!stop){stop=true;throw new Error('Interrupção simulada');}};
  await assert.rejects(g.organizeRequestFolders(),/Interrupção simulada/);
  const resumed=new EditorialGeneration(root,{}, {request:()=>{throw new Error('Não deve chamar IA');},log(){}});await resumed.initialize();
  assert.equal(resumed.state.batches.length,1);assert.equal(resumed.state.batches[0].folder,'Pedidos/gen-diario-antigo');
  assert.ok(await readFile(join(root,'Conteúdos Gerados','Pedidos/gen-diario-antigo/pedido.json')));
});

test('famílias com mesmo nome e IDs diferentes permanecem separadas',()=>{
  assert.notEqual(familyFolder('id-a','mesmo.txt'),familyFolder('id-b','mesmo.txt'));
  assert.equal(familyFolder('id-a','../../input.txt').includes('/'),false);
});

test('consolidação preserva alias e associa resultado tardio de B à coleção A+B',async t=>{
  const {root,g}=await setup(t);
  const a=await store(g,source('recorte','cut-A',['A']),[content('one','ensaio','Texto A')]);
  const b=await store(g,source('recorte','cut-B',['B']),[content('two','ensaio','Texto B')]);
  const oldA=(await catalog(root,'A')).id,oldB=(await catalog(root,'B')).id;
  await store(g,source('grupo','group-AB',['A','B']),[content('three','resumo','Texto AB')]);
  const canonical=(await catalog(root,'A')).id;
  assert.equal((await catalog(root,'B')).id,canonical);
  assert.equal(g.state.collectionAliases[canonical===oldA?oldB:oldA],canonical);
  await store(g,source('recorte','cut-B-late',['B']),[content('late','opiniao','Resultado tardio')]);
  await g.initialize();await g.initialize();
  assert.equal((await catalog(root,'A')).types.opiniao.length,1);
  assert.deepEqual((await catalog(root,'A')).types.opiniao[0].sourceIds,['B']);
  assert.equal((await catalog(root,'A')).types.ensaio.length,2);
  assert.ok(await readFile(join(root,'Conteúdos Gerados',a.unit.publicFiles[0].contentFile)));
  assert.ok(await readFile(join(root,'Conteúdos Gerados',b.unit.publicFiles[0].contentFile)));
});

test('migração do Acervo preserva edição manual, backup e metadados sem recriar conteúdo',async t=>{
  const {root,g}=await setup(t);
  const src=source('recorte','cut-A',['A']);
  const {batch,unit}=await store(g,src,[content('one','resumo','Texto original')]);
  const previous=unit.publicFiles[0],old='Acervo/'+unit.id;
  const directory=join(root,'Conteúdos Gerados',old,'resumo');await mkdir(directory,{recursive:true});
  const body='Fonte: [R01](../../fonte.md)\n\nTexto editado manualmente\n\n<a id="original-post"></a>\n';
  await writeFile(join(directory,'conteudo.md'),body);
  await writeJson(join(directory,'metadados.json'),{generationId:unit.id,generationBatchId:batch.id,posts:[{id:'original-post',contentKey:'one',destinations:[]}]});
  await rm(join(root,'Conteúdos Gerados',previous.contentFile));await rm(join(root,'Conteúdos Gerados',previous.metadataFile));
  unit.publicFiles=[{contentType:'resumo',contentFile:old+'/resumo/conteudo.md',metadataFile:old+'/resumo/metadados.json'}];unit.contentLayoutVersion=2;delete g.state.collectionLayoutVersion;await g.save();
  await g.initialize();
  const backup=g.state.collectionBackup;
  assert.equal(await readFile(join(root,backup,'Conteúdos Gerados',old,'resumo/conteudo.md'),'utf8'),body);
  const current=await readFile(join(root,'Conteúdos Gerados',g.state.units['recorte:'+src.id].publicFiles[0].contentFile),'utf8');assert.match(current,/Texto editado manualmente/);
  assert.equal((await catalog(root,'A')).types.resumo[0].publicationId,'original-post');
  await g.initialize();assert.equal(g.state.collectionBackup,backup);
  assert.equal((await readdir(join(root,'Conteúdos Gerados'))).includes('Acervo'),false);
});

test('recorte antigo em revisão sem generationId não bloqueia inicialização',async t=>{
  const {root,g}=await setup(t);
  g.state.units['recorte:legacy']={status:'legacy_review',source:source('recorte','legacy',['A']),reason:'Revisar antes de regenerar.'};await g.save();
  await g.initialize();await g.initialize();
  assert.equal(g.state.units['recorte:legacy'].status,'legacy_review');assert.equal(g.state.units['recorte:legacy'].id,undefined);
  assert.equal(Object.keys((await catalog(root,'A')).types).length,0);
});
