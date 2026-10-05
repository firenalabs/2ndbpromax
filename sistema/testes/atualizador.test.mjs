import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyBundle, sha256, validateBundle, updateSystem } from '../atualizador.mjs';
function bundle(version='1.1.0') {
 const values={'package.json':JSON.stringify({version}),'sistema/iniciar.mjs':'código novo','sistema/atualizador.mjs':'atualizador novo'};
 return {format:1,version,minNodeMajor:22,files:Object.entries(values).map(([path,text])=>({path,content:Buffer.from(text).toString('base64'),sha256:sha256(Buffer.from(text)),mode:0o644}))};
}
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'2brain-updater-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'sistema'));await mkdir(join(root,'Atlas'));await mkdir(join(root,'Entrada'));
 await writeFile(join(root,'package.json'),JSON.stringify({version:'1.0.0'}));await writeFile(join(root,'sistema','iniciar.mjs'),'código anterior');
 for(const path of ['sistema/configuracao.json','sistema/estado.json','sistema/diario.json','sistema/executor.lock','Atlas/nota.md','Entrada/texto.txt'])await writeFile(join(root,path),'dados particulares');
 return root;
}
test('atualiza somente código, guarda backup e preserva todos os dados',async t=>{
 const root=await setup(t),backup=await applyBundle(root,bundle());
 assert.equal(await readFile(join(root,'sistema','iniciar.mjs'),'utf8'),'código novo');
 assert.equal(await readFile(join(root,backup,'sistema','iniciar.mjs'),'utf8'),'código anterior');
 for(const p of ['sistema/configuracao.json','sistema/estado.json','sistema/diario.json','sistema/executor.lock','Atlas/nota.md','Entrada/texto.txt'])assert.equal(await readFile(join(root,p),'utf8'),'dados particulares');
});
test('falha no meio restaura o código anterior e remove arquivo novo',async t=>{
 const root=await setup(t),value=bundle();value.files.reverse();let writes=0;
 await assert.rejects(applyBundle(root,value,{replace:async(path,bytes)=>{if(++writes===3)throw Error('disco cheio');await writeFile(path,bytes);}}),/anterior foi restaurado/);
 assert.equal(await readFile(join(root,'sistema','iniciar.mjs'),'utf8'),'código anterior');
 assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,'1.0.0');
 await assert.rejects(readFile(join(root,'sistema','atualizador.mjs')),e=>e.code==='ENOENT');
});
test('rejeita pacote que tenta atingir configurações, dados ou caminho externo',()=>{
 for(const path of ['sistema/configuracao.json','sistema/estado.json','../arquivo','/tmp/arquivo','Atlas/nota.md','sistema/../arquivo','sistema\\iniciar.mjs']){
 const value=bundle();value.files[1].path=path;assert.throws(()=>validateBundle(value,value.version),/não permitido/);
 }
 const value=bundle();value.files[0].sha256='errado';assert.throws(()=>validateBundle(value,value.version),/integridade/);
});
test('rejeita links sem modificar destinos',async t=>{
 const root=await setup(t);await rm(join(root,'sistema','iniciar.mjs'));await symlink(join(root,'Atlas','nota.md'),join(root,'sistema','iniciar.mjs'));
 await assert.rejects(applyBundle(root,bundle()),/links/);assert.equal(await readFile(join(root,'Atlas','nota.md'),'utf8'),'dados particulares');
});
test('consulta release estável, baixa pacote com hash e aplica atualização',async t=>{
 const root=await setup(t),bytes=Buffer.from(JSON.stringify(bundle())),calls=[];
 const release={tag_name:'v1.1.0',draft:false,prerelease:false,html_url:'https://github.com/firenalabs/2ndbpromax/releases/tag/v1.1.0',assets:[{name:'atualizacao.json',browser_download_url:'https://github.com/firenalabs/2ndbpromax/releases/download/v1.1.0/atualizacao.json',digest:'sha256:'+sha256(bytes)}]};
 const request=async url=>{calls.push(url);return new Response(calls.length===1?JSON.stringify(release):bytes);};
 assert.equal((await updateSystem(root,{request,log(){}})).updated,true);assert.equal(calls.length,2);
 assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,'1.1.0');
});
test('mesma versão ou versão antiga não baixa nem altera arquivos',async t=>{
 for(const tag of ['v1.0.0','v0.9.0']){
 const root=await setup(t);let calls=0;
 assert.equal((await updateSystem(root,{request:async()=>{calls++;return new Response(JSON.stringify({tag_name:tag}));},log(){}})).updated,false);
 assert.equal(calls,1);assert.equal(await readFile(join(root,'sistema','iniciar.mjs'),'utf8'),'código anterior');
 }
});
test('falha de download ou hash não aplica atualização',async t=>{
 const root=await setup(t);await assert.rejects(updateSystem(root,{request:async()=>new Response('{}',{status:404}),log(){}}),/não há/);
 const release={tag_name:'v1.1.0',assets:[{name:'atualizacao.json',browser_download_url:'https://github.com/firenalabs/2ndbpromax/releases/download/v1.1.0/atualizacao.json',digest:'sha256:errado'}]};let calls=0;
 await assert.rejects(updateSystem(root,{request:async()=>new Response(JSON.stringify(++calls===1?release:bundle())),log(){}}),/download não corresponde/);
 assert.equal(await readFile(join(root,'sistema','iniciar.mjs'),'utf8'),'código anterior');
});
