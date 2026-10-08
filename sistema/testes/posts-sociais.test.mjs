import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeSocialBatch,collectSocialResults} from '../posts-sociais.mjs';
import {saveAutomaticContents} from '../conteudos-automaticos.mjs';
const context={referenceId:'grupo',contentSourceIds:['origem'],sourceWordCount:100};
test('posts autônomos são separados por rede; sequências ficam em um documento por rede',()=>{
 const quick=normalizeSocialBatch([{output:{posts:[{text:'Primeiro pensamento'},{text:'Segundo pensamento'}]}}],'quick',[context]);
 assert.equal(quick.generatedContents.length,6);
 assert.equal(new Set(quick.generatedContents.map(c=>c.contentKey)).size,6);
 const sequence=normalizeSocialBatch([{output:{parts:['Abertura','Continuação','Fechamento']}}],'sequence',[context]);
 assert.equal(sequence.generatedContents.length,3);
 assert.ok(sequence.generatedContents.find(c=>c.socialNetwork==='Twitter').body.includes('\n\n---\n\n'));
 assert.equal(sequence.generatedContents.find(c=>c.socialNetwork==='LinkedIn').body,'Abertura\n\nContinuação\n\nFechamento');
});
test('coleta espera todas as rotas, incluindo ângulos múltiplos e falhas, sem duplicar posts',()=>{
 const a=normalizeSocialBatch([{output:'a'},{output:'b'}],'quick',[{...context,contentIndex:1},{...context,contentIndex:2}]);
 const b=normalizeSocialBatch([{error:{message:'API indisponível'}}],'interaction',[context]);
 assert.equal(collectSocialResults([a],['quick-1','quick-2','interaction']),null);
 const complete=collectSocialResults([a,b,a],['quick-1','quick-2','interaction']);
 assert.equal(complete.generatedContents.length,6);assert.equal(complete.generatedContentErrors.length,1);
});
test('carrossel mantém slides, legenda e decisões; falha de conclusão conserva o ensaio',()=>{
 const c=normalizeSocialBatch([{output:{parts:['Segundo','Terceiro']}}],'carousel',[{...context,firstPart:'Primeiro',caption:'Legenda',carouselVariant:'carousel-tutorial',imageDecision:{accepted:true}}]);
 assert.equal(c.generatedContents.length,3);assert.deepEqual(c.generatedContents[0].parts,['Primeiro','Segundo','Terceiro']);
 assert.ok(c.generatedContents[0].body.includes('Legenda'));assert.equal(c.generatedContents[0].media.sourceDecision.accepted,true);
 const e=normalizeSocialBatch([{error:'Falha CTA'}],'essay',[{...context,essayBody:'Ensaio completo',headline:{title:'Título',subtitle:'Subtítulo'}}]);
 assert.equal(e.generatedContents.length,2);assert.equal(e.generatedContents[0].body,'Ensaio completo');assert.equal(e.generatedContentErrors.length,1);
});
test('adaptações excedentes são sinalizadas e respostas vazias não viram documentos',()=>{
 const heavy=normalizeSocialBatch([{output:{text:'a'.repeat(3001)}}],'heavy-linkedin',[context]);
 assert.equal(heavy.generatedContents.length,0);assert.equal(heavy.generatedContentErrors.length,1);
 assert.deepEqual(heavy.completedKeys,['heavy-linkedin-1']);
 const empty=normalizeSocialBatch([{output:{parts:[]}}],'thread',[context]);assert.equal(empty.generatedContentErrors.length,1);
});
test('todos os posts são salvos em pastas por rede e uma repetição não sobrescreve outro post',async t=>{
 const root=await mkdtemp(join(tmpdir(),'posts-sociais-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const result=normalizeSocialBatch([{output:{posts:[{text:'Post um'},{text:'Post dois'}]}}],'quick',[context]);
 result.generatedContents=result.generatedContents.map(c=>({...c,jevDecisions:[{key:'imagem',probability:0.8,threshold:0.7,accepted:true}]}));
 const sources=[{id:'grupo',text:'Texto original',sourceIds:['origem'],createdAt:'2026-10-08T00:00:00Z'}];
 const logs=[];for(let i=0;i<2;i++)await saveAutomaticContents(root,result,'diario',sources,x=>logs.push(x));
 assert.ok(logs.every(x=>!x.startsWith('Não foi possível')));
 for(const network of ['LinkedIn','Twitter','Instagram']){
 const dir=join(root,'Conteúdos Gerados',network),files=await readdir(dir);assert.equal(files.length,4);
 for(const file of files.filter(f=>f.endsWith('.md'))){const text=await readFile(join(dir,file),'utf8');assert.ok(text.includes('Rede social: '+network));assert.ok(text.includes('Avaliações Jev'));}
 }
 await saveAutomaticContents(root,{generatedContents:[{...result.generatedContents[0],socialNetwork:'../../fora'}]},'diario',sources,x=>logs.push(x));
 assert.ok(logs.at(-1).includes('Rede social inválida'));
});
