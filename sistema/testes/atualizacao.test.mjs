import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareUpdate } from '../preparar-atualizacao.mjs';

test('entrega copia somente programa, preserva dados e separa Codes de n8n',async t=>{
 const root=await mkdtemp(join(tmpdir(),'2brain-update-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'sistema'),{recursive:true});
 await cp(new URL('../workflows',import.meta.url),join(root,'sistema','workflows'),{recursive:true});
 for(const name of ['sistema/diario.mjs','sistema/README.md','iniciar.bat','iniciar.sh','package.json','README.md','LEIA-ME-ATUALIZACAO.md']) await writeFile(join(root,name),'programa');
 for(const name of ['configuracao.json','estado.json','diario.json','executor.lock']) await writeFile(join(root,'sistema',name),'dados privados');
 const result=await prepareUpdate(root),client=join(result.base,'Copiar para o cliente');
 assert.deepEqual(await readdir(join(client,'sistema')),['README.md','diario.mjs']);
 assert.equal((await readdir(join(result.base,'Colar no n8n'))).filter(n=>n.endsWith('.js')).length,5);
 // Simulate merge in an existing client, then run preparation again.
 const customer=join(root,'cliente');await mkdir(join(customer,'sistema'),{recursive:true});
 await writeFile(join(customer,'sistema','configuracao.json'),'configuração do cliente');
 await cp(client,customer,{recursive:true,force:true});
 assert.equal(await readFile(join(customer,'sistema','configuracao.json'),'utf8'),'configuração do cliente');
 await writeFile(join(root,'sistema','diario.mjs'),'programa atualizado');await prepareUpdate(root);
 assert.equal(await readFile(join(client,'sistema','diario.mjs'),'utf8'),'programa atualizado');
 assert.equal(await readFile(join(root,'sistema','estado.json'),'utf8'),'dados privados');
});
