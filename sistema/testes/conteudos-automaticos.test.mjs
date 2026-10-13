import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {structureAutomaticContent,saveAutomaticContents} from '../conteudos-automaticos.mjs';
import {extendContentWorkflow} from '../estender-workflows-conteudos.mjs';
const context={referenceId:'ref',contentSourceIds:['source'],sourceWordCount:3,contentTitle:'Título'};
test('Markdown, aspas e erros são estruturados sem parser nem outro Agent',()=>{
 const r=structureAutomaticContent({output:'# Título\n\nEle disse "olá".'},context,'atlas');
 assert.equal(r.generatedContents[0].wordCount,5);
 assert.ok(r.generatedContents[0].body.includes('"olá"'));
 assert.deepEqual(structureAutomaticContent({},context,'atlas').generatedContents,[]);
 assert.equal(structureAutomaticContent({error:'API indisponível'},context,'atlas').generatedContentErrors.length,1);
});
test('salvamento separa origens, é idempotente e conserva o corpo',async t=>{
 const root=await mkdtemp(join(tmpdir(),'auto-content-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sources=[{id:'ref',text:'um dois três',sourceIds:['source']}];
 for(const origin of ['atlas','diario'])for(let i=0;i<2;i++)await saveAutomaticContents(root,structureAutomaticContent({output:'# Título\nTexto completo.'},context,origin),origin,sources,()=>{});
 const files=await readdir(join(root,'Conteúdos Gerados'));assert.equal(files.length,4);
 for(const file of files.filter(f=>f.endsWith('.md')))assert.equal(await readFile(join(root,'Conteúdos Gerados',file),'utf8'),'# Título\nTexto completo.\n');
});
test('Atlas modular mantém conhecimento e posicionamento sem geração editorial',async()=>{
 const w=JSON.parse(await readFile(new URL('../workflows/02a-atlas.importar.json',import.meta.url),'utf8'));
 assert.ok(w.nodes.some(n=>n.name==='Jev — Tem conhecimento?'));
 assert.ok(w.nodes.some(n=>n.name==='Agent: Preparador de Notas'));
 assert.equal(w.nodes.some(n=>n.name.startsWith('Agent: Conteúdo')),false);
 assert.deepEqual(w.connections['Conhecimento aceito?'].main[0].map(e=>e.node),['Agent: Preparador de Notas']);
});
