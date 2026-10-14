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
const catalog=async(root,id)=>JSON.parse(await readFile(join(root,'Conteúdos Gerados','Famílias',familyFolder(id,id+'.txt'),'familia.json')));

test('família reúne tipos que chegam em momentos diferentes; grupo A+B aponta ao mesmo post em A e B',async t=>{
  const {root,g}=await setup(t);
  const cut=await store(g,source('recorte','cut-A',['A']),[content('quick','pensamento-rapido','Pensamento único A')]);
  assert.deepEqual(Object.keys((await catalog(root,'A')).types),['pensamento-rapido']);
  const group=await store(g,source('grupo','group-AB',['A','B']),[content('opinion','opiniao','Opinião única A+B')]);
  const a=await catalog(root,'A'),b=await catalog(root,'B');
  assert.deepEqual(Object.keys(a.types),['opiniao','pensamento-rapido']);assert.deepEqual(Object.keys(b.types),['opiniao']);
  assert.equal(a.types.opiniao[0].publicationId,b.types.opiniao[0].publicationId);assert.equal(a.types.opiniao[0].shared,true);
  assert.deepEqual(a.types.opiniao[0].sourceIds,['A','B']);
  const target=(id,ref)=>resolve(root,'Conteúdos Gerados','Famílias',familyFolder(id,id+'.txt'),'opiniao',decodeURIComponent(ref.file.split('#')[0]));
  assert.equal(target('A',a.types.opiniao[0]),target('B',b.types.opiniao[0]));
  const index=await readFile(join(root,'Conteúdos Gerados','Famílias',familyFolder('A','A.txt'),'opiniao','índice.md'),'utf8');assert.match(index,/A.txt \+ B.txt/);
  assert.equal((await readdir(join(root,'Conteúdos Gerados','Acervo'))).length,2);
  assert.ok(await readFile(join(root,'Conteúdos Gerados',group.unit.contentFolder,'opiniao/conteudo.md')));
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
