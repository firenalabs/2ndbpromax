import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { segmentText } from '../contratos.mjs';
import { saveMaterials, listMaterials } from '../materiais.mjs';
import { DiaryRecords } from '../diario-registros.mjs';
import { EditorialGeneration } from '../geracao-editorial.mjs';
import { normalizeEditorial } from '../outputs-editoriais.mjs';
import { writeJson } from '../arquivos.mjs';
import { migrateModularPipeline } from '../migracoes-configuracao.mjs';
import { buildModular } from '../workflows/build-modular.mjs';
const config={modularPipelineVersion:1,timezone:'America/Sao_Paulo',diaryWebhook:'http://example.invalid/diary',generationWebhook:'http://example.invalid/editorial',aspectThreshold:.8,continuityThreshold:.8};
const reply=v=>({ok:true,json:async()=>v});
async function rootFor(t){const root=await mkdtemp(join(tmpdir(),'brain-modular-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'sistema'));return root;}
function digest(id,text='Uma ideia útil.',createdAt='2026-10-13T12:00:00Z'){
 const segmentation=segmentText(text);return {id:id+'-digest-v1',sourceId:id,originalText:text,createdAt,updatedAt:createdAt,schemaVersion:1,segmentation,segmentedText:segmentation.segments.map(s=>'['+s.id+'] '+text.slice(s.start,s.end).trim()).join('\n'),keytopics:[{id:segmentation.segments[0].id,title:text,bulletpoints:[text]}]};
}
const successful=(payload)=>({ok:true,posts:[{contentKey:'post-1:Twitter',platform:'Twitter',format:'single_text',contentType:'pensamento',title:'Título',body:payload.source.text,parts:[payload.source.text]}],errors:[],cache:{agent:{0:[{output:{text:payload.source.text}}]}},workflowId:'workflow',executionId:'execution'});

test('materiais compartilhados preservam cortes e identidade sem repetir a interpretação',async t=>{
 const root=await rootFor(t),d=digest('source-a','Introdução. Ideia dois.');d.keytopics.push({id:d.segmentation.segments[1].id,title:'Segundo assunto',bulletpoints:['Ideia dois.']});
 const r=await saveMaterials(root,d,'source-a');await saveMaterials(root,d,'source-a');
 assert.equal(r.blocks.map(b=>b.text).join(''),d.originalText);assert.equal((await listMaterials(root)).length,1);
 assert.equal((await readdir(join(root,'Recortes por Assunto','source-a'))).length,4);
 const changed=structuredClone(d);changed.blocks=structuredClone(r.blocks);changed.blocks[0].text='alterado';await assert.rejects(saveMaterials(root,changed,'source-a'),/text/);
});
test('Diário registra primeiro input imediatamente, sem comparação e sem geração editorial',async t=>{
 const root=await rootFor(t),calls=[];
 const request=async(_,o)=>{const p=JSON.parse(o.body);calls.push(p);const flags={victory:false,obstacle:false,story:false,gratitude:false,joke:false,personalLife:false};return reply({ok:true,diary:{title:'Registro',summary:'Resumo factual.'},aspects:{flags,decisions:Object.fromEntries(Object.keys(flags).map(k=>[k,{probability:.1,threshold:.8,accepted:false}]))},achievements:[],errors:{}});};
 const diary=new DiaryRecords(root,config,{request,log(){}});await diary.initialize();await diary.accept(digest('a'),'a.txt');
 assert.equal(diary.state.records[0].status,'pending');await diary.finalizePending();
 assert.equal(diary.state.records[0].status,'completed');assert.deepEqual(calls.map(p=>p.operation),['finalize']);
 await diary.accept(digest('a'),'a.txt');await diary.finalizePending();assert.equal(calls.length,1);
 assert.match(await readFile(join(root,'Diário','Registros','2026-10-13 - a.md'),'utf8'),/Uma ideia útil/);
});
test('fila de recortes ignora datas, preserva concluídos e retoma com checkpoints',async t=>{
 const root=await rootFor(t);for(const [id,date]of [['a','2026-10-10T12:00:00Z'],['b','2026-10-13T12:00:00Z']])await saveMaterials(root,digest(id,'Ideia '+id+'.',date),id);
 let failed=true;const calls=[];const g=new EditorialGeneration(root,config,{log(){},request:async(_,o)=>{const p=JSON.parse(o.body);calls.push(p);const r=successful(p);if(p.source.sourceId==='b'&&failed){failed=false;r.errors=[{message:'uma saída falhou'}];}return reply(r);}});await g.initialize();await g.runCuts();
 assert.equal(calls.length,2);assert.equal(g.state.batches[0].status,'partial');assert.equal(Object.values(g.state.units).filter(u=>u.status==='completed').length,1);
 await g.runCuts();assert.equal(calls.length,3);assert.equal(calls[2].source.sourceId,'b');assert.ok(calls[2].cache.agent);assert.equal(g.state.batches.length,1);
 await g.runCuts();assert.equal(calls.length,3);assert.equal(g.state.batches[0].status,'completed');
 const folder=join(root,'Conteúdos Gerados',g.state.batches[0].folder);assert.ok((await readdir(join(folder,'Twitter'))).some(n=>n.endsWith('.md')));
});
test('agrupamento do Diário usa originais A+B e C, encerra último grupo e não regenera ao repetir',async t=>{
 const root=await rootFor(t);for(const id of ['a','b','c'])await saveMaterials(root,digest(id,'Original '+id+'.'),id);
 const calls=[];const g=new EditorialGeneration(root,config,{log(){},request:async(_,o)=>{const p=JSON.parse(o.body);calls.push(p);if(p.operation==='compare'){const accepted=p.second.sourceId==='b';return reply({ok:true,decision:{probability:accepted?.95:.05,threshold:.8,accepted}});}return reply(successful(p));}});await g.initialize();await g.runDiary('2026-10-13');
 const generated=calls.filter(p=>p.operation==='generate');assert.equal(generated.length,2);assert.equal(generated[0].source.text,'Original a.\n\nOriginal b.');assert.equal(generated[1].source.text,'Original c.');
 assert.deepEqual(generated[0].source.sourceIds,['a','b']);await g.runDiary('2026-10-13');assert.equal(calls.length,4);
});
test('posts independentes se separam e sequências ficam num item por rede',()=>{
 const r=normalizeEditorial({outputsDosAgents:[{agent:'Tweets/Stories sem angulo',run:0,item:0,output:{posts:[{text:'A'},{text:'B'}]}},{agent:'Sequência de pensamentos rápidos',run:0,item:0,output:{parts:['Parte A','Parte B']}}],resultadosFinais:[],erros:[]});
 assert.equal(r.posts.length,9);assert.equal(r.posts.filter(p=>p.contentType==='sequencia').length,3);assert.equal(r.posts.find(p=>p.contentType==='sequencia'&&p.platform==='Twitter').parts.length,2);
});
test('workflows extraídos preservam Agents/modelos e eliminam dependência editorial do Atlas e Diário',async()=>{
 const original=JSON.parse(await readFile(new URL('../workflows/modular-originais.json',import.meta.url)));const all=await buildModular();
 for(const key of ['prep','atlas','diary'])for(const n of all[key].nodes.filter(n=>/\.agent$|lmChat/.test(n.type))){const old=original[key].nodes.find(o=>o.name===n.name);assert.deepEqual(n.parameters,old.parameters);}
 for(const n of all.generation.nodes.filter(n=>n.type.endsWith('.agent'))){const old=original.test.nodes.find(o=>o.name+' — chamada'===n.name);assert.deepEqual(n.parameters,old.parameters);assert.equal(n.onError,old.onError);}
 assert.equal(all.generation.nodes.some(n=>n.name==='Jev — Tem conhecimento?'),false);assert.equal(all.atlas.nodes.some(n=>n.name.startsWith('Agent: Conteúdo')),false);
 const names=new Set(all.generation.nodes.map(n=>n.name));for(const c of Object.values(all.generation.connections))for(const e of Object.values(c).flat(2))assert.ok(names.has(e.node));
});
test('migração de configuração mantém servidor/proxy, cria webhook editorial e é idempotente',async t=>{
 const root=await rootFor(t),c={diaryWebhook:'https://example.invalid/n8n/webhook/segundo-cerebro-local-diario-social-v2',custom:true};await writeJson(join(root,'sistema','configuracao.json'),c);
 const r=await migrateModularPipeline(root,c);assert.equal(r.generationWebhook,'https://example.invalid/n8n/webhook/segundo-cerebro-local-conteudos-v1');assert.equal(r.custom,true);assert.deepEqual(await migrateModularPipeline(root,r),r);
});

test('saídas malformadas de partes não interrompem organização de outros posts',()=>{
 const result=normalizeEditorial({outputsDosAgents:[{agent:'Tweets/Stories sem angulo',run:0,item:0,output:{posts:[{text:'Válido'}]}}],resultadosFinais:[{node:'Reunir carrossel e legenda',run:0,item:0,resultado:{output:{parts:'inválido'}}}],erros:[]});
 assert.equal(result.posts.length,3);assert.equal(result.errors.length,1);
});
