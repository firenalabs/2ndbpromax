import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiaryProcessor } from '../diario.mjs';
import { segmentText } from '../contratos.mjs';
import { countContentWords, contentRange, structureGeneratedContent, validateGeneratedContent, contentWebhookFor } from '../conteudos.mjs';

const config={diaryWebhook:'http://example.invalid/diary',requestTimeoutMs:1000,continuityThreshold:0.8,aspectThreshold:0.8,maxGroupCharacters:120000};
const decision={probability:0.05,threshold:0.8,accepted:false};
const aspects={flags:Object.fromEntries(['victory','obstacle','story','gratitude','joke','personalLife'].map(k=>[k,false])),decisions:Object.fromEntries(['victory','obstacle','story','gratitude','joke','personalLife'].map(k=>[k,{...decision}]))};
function digest(id,text) {
  const segmentation=segmentText(text),now='2026-10-05T12:00:00.000Z';
  return {id:id+'-digest-v1',sourceId:id,schemaVersion:1,createdAt:now,updatedAt:now,originalText:text,segmentation,
    segmentedText:segmentation.segments.map(s=>'['+s.id+'] '+text.slice(s.start,s.end).trim()).join('\n'),keytopics:[{id:'SEG_00001',title:'Uma ideia',bulletpoints:['Uma ideia expressa.']}]};
}
async function setup(t,transform=value=>value) {
  const root=await mkdtemp(join(tmpdir(),'conteudos-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const requests=[];
  const request=async(url,options)=>{
    const p=JSON.parse(options.body),target=url.includes("conteudos-v1")?"content":"diary";requests.push({...p,target});
    const result=p.operation==='compare'?{ok:true,decision}:transform(target==='content'?{ok:true,errors:{},generatedContent:structureGeneratedContent({title:'Conhecimento gerado',body:'Uma explicação útil.\n\n## Aplicação\nUse o conceito.'},p.text)}:{ok:true,aspects,diary:{title:'Diário',summary:'Resumo do grupo.'},achievements:[],errors:{}},p,target);
    return {ok:result.ok,status:result.ok?200:422,json:async()=>result};
  };
  const diary=new DiaryProcessor(root,config,{request,log(){}});await diary.initialize();return {root,diary,requests,request};
}
async function closeGroup(diary,words) {
  await diary.accept(digest('primeiro',Array(words).fill('ideia').join(' ')),'primeiro.txt');
  await diary.accept(digest('segundo','Outro assunto distinto.'),'segundo.txt');
  return diary.state.groups[0];
}

test('faixas e estrutura usam contagem real e rejeitam metadados inconsistentes',()=>{
  assert.equal(contentWebhookFor({diaryWebhook:'https://n8n.exemplo.com/proxy/webhook/diario'}),'https://n8n.exemplo.com/proxy/webhook/segundo-cerebro-local-conteudos-v1');
  assert.equal(contentWebhookFor({contentWebhook:'https://custom.example/content'}),'https://custom.example/content');
  assert.equal(countContentWords('  um\n dois\t três '),3);
  for(const [n,range] of [[150,null],[151,'151 a 600'],[600,'151 a 600'],[601,'601 a 1499'],[1499,'601 a 1499'],[1500,'1500+']])assert.equal(contentRange(Array(n).fill('x').join(' ')),range);
  const text=Array(151).fill('x').join(' '),value=structureGeneratedContent({title:'Título',body:'Corpo do texto.'},text);
  assert.deepEqual(validateGeneratedContent(value,text),value);
  assert.throws(()=>validateGeneratedContent({...value,sourceWordCount:200},text),/Metadado inválido/);
  assert.throws(()=>structureGeneratedContent({title:'Título',body:''},text),/title e body/);
});

for(const [words,range] of [[151,'151 a 600'],[601,'601 a 1499'],[1500,'1500+']])test(`grupo ${range} salva Markdown e JSON por chamada independente`,async t=>{
  const {root,diary,requests}=await setup(t),group=await closeGroup(diary,words);
  await diary.finalizePending({generateContent:true});await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'completed');assert.equal(group.diaryStatus,'completed');assert.equal(group.bragStatus,'skipped');
  assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='diary').length,1);
  assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='content').length,1);
  const payloads=requests.filter(p=>p.operation==='finalize').map(({target,...payload})=>payload);
  assert.deepEqual(payloads[0],payloads[1]);
  const record=JSON.parse(await readFile(join(root,group.contentFile),'utf8'));
  assert.equal(record.id,'primeiro-group-v1-content-v1');assert.equal(record.groupId,group.id);assert.deepEqual(record.sourceIds,['primeiro']);assert.equal(record.wordRange,range);assert.equal(record.sourceWordCount,words);
  assert.ok(Date.parse(record.createdAt));assert.ok(Date.parse(record.updatedAt));
  const files=await readdir(join(root,'Conteúdos Gerados'));assert.equal(files.filter(f=>f.endsWith('.json')).length,1);
  const markdown=await readFile(join(root,'Conteúdos Gerados',files.find(f=>f.endsWith('.md')&&f!=='README.md')),'utf8');assert.equal(markdown,`# ${record.title}\n\n${record.body}\n`);
});

test('até 150 palavras não gera arquivo de conteúdo nem impede Diário',async t=>{
  const {root,diary}=await setup(t),group=await closeGroup(diary,150);await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'skipped');assert.equal(group.diaryStatus,'completed');assert.deepEqual(await readdir(join(root,'Conteúdos Gerados')),['README.md']);
});

test('erro do Agent conserva Diário e pode tentar conteúdo novamente sem duplicação',async t=>{
  let broken=true;
  const {root,diary,requests}=await setup(t,result=>broken?{...result,generatedContent:null,errors:{generatedContent:'Falha no Agent.'}}:result);
  const group=await closeGroup(diary,151);await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'failed');assert.equal(group.diaryStatus,'completed');assert.equal(group.bragStatus,'skipped');
  broken=false;await diary.finalizePending({retry:true,generateContent:true});await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'completed');assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='content').length,2);assert.equal((await readdir(join(root,'Conteúdos Gerados'))).filter(f=>f.endsWith('.json')).length,1);
  assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='diary').length,1);
});

test('falha somente na gravação reutiliza a resposta salva sem nova chamada',async t=>{
  const {diary,requests}=await setup(t),group=await closeGroup(diary,151),write=diary.writeGeneratedContent.bind(diary);
  diary.writeGeneratedContent=async()=>{throw Error('Falha de gravação.');};await diary.finalizePending({generateContent:true});assert.equal(group.contentStatus,'failed');assert.ok(group.generatedContent);
  diary.writeGeneratedContent=write;await diary.finalizePending({retry:true,generateContent:true});assert.equal(group.contentStatus,'completed');assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='diary').length,1);
});

test('Diário e Conquistas são salvos enquanto a chamada independente de conteúdo ainda aguarda',async t=>{
  const {diary,request}=await setup(t),group=await closeGroup(diary,151);
  let release;const waiting=new Promise(resolve=>{release=resolve;});let contentStarted=false;
  diary.request=async(url,options)=>{if(url.includes('conteudos-v1')){contentStarted=true;await waiting;}return request(url,options);};
  const running=diary.finalizePending({generateContent:true});
  try {
    for(let i=0;i<100&&group.bragStatus!=='skipped';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(contentStarted,true);assert.equal(group.diaryStatus,'completed');assert.equal(group.bragStatus,'skipped');assert.equal(group.contentStatus,'pending');
  } finally {release();await running;}
  assert.equal(group.contentStatus,'completed');
});

test('conteúdo válido é salvo mesmo se a etapa do Diário retorna erro',async t=>{
  const {root,diary}=await setup(t,(result,p,target)=>target==='diary'?{ok:false,error:{message:'Jev indisponível.'}}:result);
  const group=await closeGroup(diary,151);await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'completed');assert.equal(group.diaryStatus,'failed');assert.ok(await readFile(join(root,group.contentFile),'utf8'));
});

test('workflow antigo sem conteúdo informa atualização e conserva Diário',async t=>{
  const {diary}=await setup(t,result=>{delete result.generatedContent;return result;}),group=await closeGroup(diary,151);await diary.finalizePending({generateContent:true});
  assert.equal(group.contentStatus,'failed');assert.match(group.contentError,/Atualize e publique/);assert.equal(group.diaryStatus,'completed');
});

test('atualização preserva grupos antigos concluídos e continua o grupo aberto',async t=>{
  const {root,diary,request,requests}=await setup(t),group=await closeGroup(diary,151);await diary.finalizePending({generateContent:true});
  for(const g of diary.state.groups){delete g.contentStatus;delete g.generatedContent;delete g.contentFile;}
  await writeFile(join(root,'sistema','diario.json'),JSON.stringify(diary.state));
  const restarted=new DiaryProcessor(root,config,{request,log(){}});await restarted.initialize();await restarted.finalizePending({generateContent:true});
  assert.equal(restarted.state.groups[0].contentStatus,'skipped');assert.equal(restarted.state.openGroupId,'segundo-group-v1');assert.equal(restarted.state.groups[1].contentStatus,'pending');assert.equal(requests.filter(p=>p.operation==='finalize'&&p.target==='diary').length,1);
});


test('processamento normal não chama conteúdo; acionamento manual gera uma vez', async t=>{
  const {diary,requests}=await setup(t),group=await closeGroup(diary,151);
  await diary.finalizePending();
  assert.equal(group.diaryStatus,'completed');
  assert.equal(group.contentStatus,'pending');
  assert.equal(requests.filter(p=>p.target==='content').length,0);
  await diary.generatePendingContents(); await diary.generatePendingContents();
  assert.equal(group.contentStatus,'completed');
  assert.equal(requests.filter(p=>p.target==='content').length,1);
  assert.equal(requests.filter(p=>p.target==='diary' && p.operation==='finalize').length,1);
});


test('geração manual não dispara nem tenta novamente Diário pendente',async t=>{
 const {diary,requests}=await setup(t),group=await closeGroup(diary,151);
 await diary.generatePendingContents();
 assert.equal(group.contentStatus,'completed');assert.equal(group.diaryStatus,'pending');
 assert.equal(requests.filter(p=>p.operation==='finalize' && p.target==='diary').length,0);
});
