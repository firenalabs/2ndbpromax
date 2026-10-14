import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {centralizePosts,normalizeCentralEditorial} from '../conteudo-centralizado.mjs';
import {EditorialGeneration} from '../geracao-editorial.mjs';
import {buildModular} from '../workflows/build-modular.mjs';
import {withoutNetworkAdaptations,networkAdaptationNodes} from '../workflows/conteudo-sem-adaptacoes.mjs';
import {writeJson} from '../arquivos.mjs';

const heavy='Texto inteiro acima dos limites.\n'.repeat(200);
const result={outputsDosAgents:[
  {agent:'Tweets/Stories sem angulo',run:0,item:0,output:{posts:[{text:'Pensamento A'},{text:'Pensamento B'}]}},
  {agent:'Sequência de pensamentos rápidos',run:0,item:0,output:{parts:['Parte A','Parte B']}},
],resultadosFinais:[
  {node:'Conservar decisão — imagem-post',run:0,item:0,resultado:{baseText:heavy,imageDecision:{accepted:false}}},
  {node:'Adaptar text-heavy — Instagram',run:0,item:0,resultado:{output:{text:'Texto reduzido antigo'}}},
  {node:'Reunir carrossel e legenda',run:0,item:0,resultado:{partsOutput:{parts:['Slide A','Slide B']},caption:'Legenda única',carouselVariant:'tutorial'}},
  {node:'Reunir carrossel e legenda',run:1,item:0,resultado:{partsOutput:{parts:['Slide C']},caption:'Outra legenda',carouselVariant:'checklist'}},
  {node:'Organizar thread completa por rede1',run:0,item:0,resultado:{generatedContents:['Twitter','LinkedIn','Instagram'].map(socialNetwork=>({socialNetwork,parts:['Tweet A','Tweet B'],media:{sourceDecision:[{accepted:true}]}}))}},
],erros:[]};

test('conteúdo-base não aplica limites; reúne redes sem misturar posts nem variantes editoriais',()=>{
  const r=normalizeCentralEditorial(result);
  assert.equal(r.contents.length,7);assert.equal(r.errors.length,0);
  const educativo=r.contents.find(c=>c.contentType==='educativo');
  assert.deepEqual(educativo.parts,[heavy]);assert.equal(educativo.destinations.length,3);
  assert.equal(r.contents.some(c=>c.parts.includes('Texto reduzido antigo')),false);
  assert.equal(r.contents.filter(c=>c.contentType==='pensamento-rapido').length,2);
  assert.equal(r.contents.filter(c=>c.contentType==='utilidade').length,2);
  const resumo=r.contents.find(c=>c.contentType==='resumo');
  assert.deepEqual(resumo.parts,['Tweet A','Tweet B']);assert.equal(resumo.destinations.length,3);
  assert.deepEqual(r.contents.find(c=>c.contentType==='sequencia').parts,['Parte A','Parte B']);
});

test('saídas legadas diferentes são preservadas; textos iguais de posts diferentes não são fundidos',()=>{
  const post={contentKey:'etapa:0:0:Twitter',platform:'Twitter',format:'single_text',contentType:'opiniao',title:'Título',body:'Texto A',parts:['Texto A']};
  const r=centralizePosts([post,{...post,contentKey:'etapa:0:0:LinkedIn',platform:'LinkedIn',body:'Texto B',parts:['Texto B']},
    {...post,contentKey:'etapa:0:1:Twitter'}]);
  assert.equal(r.contents.length,3);assert.equal(r.warnings.length,1);
  assert.deepEqual(r.contents.map(c=>c.parts[0]),['Texto A','Texto B','Texto A']);
});

test('workflow elimina 24 nodes de adaptação; conserva as chamadas editoriais e seus modelos',async()=>{
  const before=(await buildModular({centralize:false})).generation,after=withoutNetworkAdaptations(before);
  assert.equal(before.nodes.length-after.nodes.length,24);assert.equal(after.nodes.length,163);
  for(const n of after.nodes) {
    const old=before.nodes.find(v=>v.name===n.name);
    if(!['Ver todos os outputs dos Agents','Organizar posts e checkpoints','Sticky Note2','Sticky Note7'].includes(n.name))assert.deepEqual(n,old);
    assert.deepEqual(n.position,old.position);
    if(n.type==='n8n-nodes-base.code')new Function('$input','$','$runIndex',n.parameters.jsCode);
  }
  const removed=new Set(networkAdaptationNodes),names=new Set(after.nodes.map(n=>n.name));
  for(const c of Object.values(after.connections))for(const e of Object.values(c).flat(2))assert.ok(names.has(e.node));
  for(const n of after.nodes)for(const match of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g))assert.equal(removed.has(match[1]),false);
  for(const name of ['Conservar decisão — imagem-post','Conservar decisão — imagem-post1'])assert.deepEqual(after.connections[name].main[0],[{node:'Ver todos os outputs dos Agents',type:'main',index:0}]);
  assert.deepEqual(withoutNetworkAdaptations(after),after);
});

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'conteudo-central-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'sistema'));
  const g=new EditorialGeneration(root,{generationWebhook:'https://example.invalid'},{log(){}});await g.initialize();
  const source={id:'source-group',kind:'grupo',text:'Original A\n\nOriginal B',keytopic:'Minha explicação',sourceIds:['a','b'],digestIds:['da','db'],continuity:[{firstSourceId:'a',secondSourceId:'b',accepted:true}]};
  const batch=await g.createBatch('diario',[source]);
  const unit={id:'generation-id',code:'G01',source,batchId:batch.id,status:'partial',files:[],cache:{},errors:[]};
  g.state.units['grupo:'+source.id]=unit;
  return {root,g,batch,unit};
}

test('um Markdown por grupo/tipo reúne todos os posts; metadados não repetem texto',async t=>{
  const {root,g,batch,unit}=await setup(t),normalized=normalizeCentralEditorial(result);
  await g.writeContents(batch,unit,normalized.contents,{workflowId:'wf',executionId:'exec'});await g.manifest(batch);
  const dir=join(root,'Conteúdos Gerados',unit.contentFolder);
  const md=await readFile(join(dir,'pensamento-rapido','conteudo.md'),'utf8');
  assert.equal(md.includes('Pensamento A'),true);assert.equal(md.includes('Pensamento B'),true);
  assert.equal(md.match(/Pensamento A/g).length,2); // título + corpo, sem cópias por rede
  const metadata=JSON.parse(await readFile(join(dir,'pensamento-rapido','metadados.json')));
  assert.equal(metadata.posts.length,2);assert.equal(metadata.posts[0].destinations.length,3);
  assert.equal(JSON.stringify(metadata).includes('Pensamento A'),false);
  assert.deepEqual(metadata.source.sourceIds,['a','b']);
  const heavyMd=await readFile(join(dir,'educativo','conteudo.md'),'utf8');assert.ok(heavyMd.includes(heavy.trim()));
  assert.equal((await readdir(join(root,'Conteúdos Gerados',batch.folder))).includes('Twitter'),false);
  const carousel=await readFile(join(dir,'utilidade','conteudo.md'),'utf8');
  assert.match(carousel,/Bloco 1/);assert.match(carousel,/Bloco 2/);assert.match(carousel,/Legenda única/);assert.match(carousel,/Outra legenda/);
  const origin=JSON.parse(await readFile(join(dir,'origem.json')));assert.deepEqual(origin.continuity,unit.source.continuity);
});

test('tentativas parciais conservam resultados anteriores e seus checkpoints',async t=>{
  const {root,g,batch,unit}=await setup(t);let calls=0;
  const first=normalizeCentralEditorial(result).contents[0],second=normalizeCentralEditorial(result).contents[1];
  g.request=async(_,options)=>{const payload=JSON.parse(options.body);if(calls)assert.deepEqual(payload.cache,{saved:{0:[{output:'Válido'}]}});calls++;
    return {ok:true,json:async()=>({contents:[calls===1?first:second],errors:calls===1?[{node:'Agent',erro:{message:'Falha temporária'}}]:[],cache:{saved:{0:[{output:'Válido'}]}},workflowId:'wf',executionId:'exec-'+calls})};};
  await g.executeBatch(batch);assert.equal(unit.status,'partial');await g.executeBatch(batch);assert.equal(unit.status,'completed');
  const metadata=JSON.parse(await readFile(join(root,'Conteúdos Gerados',unit.contentFolder,'pensamento-rapido','metadados.json')));
  assert.equal(metadata.posts.length,2);assert.deepEqual(metadata.posts.map(p=>p.executionId),['exec-1','exec-2']);assert.equal(calls,2);await g.executeBatch(batch);assert.equal(calls,2);
});

test('reorganiza resultados já salvos sem IA e remove somente arquivos antigos comprovados',async t=>{
  const {root,g,batch,unit}=await setup(t);const directory=join(root,'Conteúdos Gerados',batch.folder);
  await mkdir(join(directory,'Twitter'));unit.files=['Twitter/antigo.md'];unit.status='completed';
  const {writeFile}=await import('node:fs/promises');await writeFile(join(directory,'Twitter/antigo.md'),'Antigo');
  await writeJson(join(directory,'Twitter/antigo.json'),{generationId:unit.id,generationBatchId:batch.id});
  await writeFile(join(directory,'Twitter/manual.md'),'Arquivo do usuário');
  await writeJson(join(directory,'Fontes/G01-execucao.json'),{diagnostics:result,workflowId:'wf',executionId:'exec'});
  g.request=()=>{throw new Error('Não deve chamar IA');};
  await g.reorganizeSavedOutputs();
  await assert.rejects(readFile(join(directory,'Twitter/antigo.md')),{code:'ENOENT'});
  assert.equal(await readFile(join(directory,'Twitter/manual.md'),'utf8'),'Arquivo do usuário');
  assert.ok((await readFile(join(directory,unit.files.find(f=>f.includes('/educativo/'))),'utf8')).includes(heavy.trim()));
  assert.ok((await readFile(join(directory,'Fontes/G01-execucao.json'),'utf8')).includes('Texto reduzido antigo'));
});
