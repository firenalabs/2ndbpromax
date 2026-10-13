import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFolders, folders, writeJson } from '../arquivos.mjs';
import { configureN8n, configureInteractive, resetInteractive, resetFiles } from '../manutencao.mjs';
import { Executor } from '../executor.mjs';

const config = {
  digestWebhook: 'http://localhost:5678/webhook/digestao',
  atlasWebhook: 'http://localhost:5678/webhook/atlas',
  diaryWebhook: 'http://localhost:5678/webhook/diario',
  workflowId: 'preservar', knowledgeThreshold: 0.8,
};
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), '2brain-manutencao-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureFolders(root);
  return root;
}

test('configura os três webhooks, aceita prefixo de proxy e mantém demais opções', async t => {
  const root = await setup(t);
  await configureInteractive(root, config, async () => ' https://n8n.exemplo.com/n8n/ ', () => {});
  const saved = JSON.parse(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8'));
  assert.equal(saved.n8nBaseUrl, 'https://n8n.exemplo.com/n8n');
  for (const [key, endpoint] of [['digestWebhook', 'digestao'], ['atlasWebhook', 'atlas'], ['diaryWebhook', 'diario']]) {
    assert.equal(saved[key], `https://n8n.exemplo.com/n8n/webhook/${endpoint}`);
  }
  assert.equal(saved.workflowId, config.workflowId);
  assert.equal(Object.hasOwn(saved, 'contentWebhook'), false);
  assert.equal(Object.hasOwn(configureN8n({...config, contentWebhook: 'https://obsolete.invalid'}, 'localhost:5678'), 'contentWebhook'), false);
  assert.equal(saved.knowledgeThreshold, 0.8);
  assert.equal(config.digestWebhook, 'http://localhost:5678/webhook/digestao');
  assert.equal(configureN8n(saved, 'localhost:5678').digestWebhook, config.digestWebhook);
  assert.equal(configureN8n(config, 'n8n.exemplo.com').n8nBaseUrl, 'https://n8n.exemplo.com');
});

test('URL inválida e cancelamento mantêm configuração anterior', async t => {
  const root = await setup(t);
  await writeJson(join(root, 'sistema', 'configuracao.json'), config);
  for (const address of ['', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com?x=1', 'https://example.com/#x', 'https://example.com/webhook/teste', 'https://']) {
    assert.throws(() => configureN8n(config, address));
  }
  await configureInteractive(root, config, async () => '', () => {});
  assert.deepEqual(JSON.parse(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8')), config);
});

test('limpeza confirmada apaga todos os dados e preserva configuração, código, exemplos e READMEs das pastas ativas', async t => {
  const root = await setup(t);
  for (const folder of Object.values(folders)) {
    await mkdir(join(root, folder, 'Subpasta'), { recursive: true });
    await writeFile(join(root, folder, 'README.md'), 'Orientações');
    await writeFile(join(root, folder, 'Subpasta', 'README.md'), 'Orientações internas');
    await writeFile(join(root, folder, 'Subpasta', 'registro.json'), '{}');
    await writeFile(join(root, folder, 'registro.md'), 'Dados');
  }
  await mkdir(join(root, 'Exemplos'));
  const protectedFiles = ['sistema/configuracao.json', 'sistema/executor.lock', 'sistema/iniciar.mjs', 'Exemplos/exemplo.txt', 'README.md'];
  for (const path of protectedFiles) await writeFile(join(root, path), 'Preservar');
  for (const name of ['estado.json', 'estado.json.tmp', 'diario.json', 'diario.json.tmp']) await writeFile(join(root, 'sistema', name), 'Apagar');
  const files = await resetFiles(root);
  assert.equal(await resetInteractive(root, async () => 'cancelar', () => {}), false);
  assert.equal(await readFile(join(root, 'Atlas', 'Subpasta', 'registro.json'), 'utf8'), '{}');
  assert.equal(await resetInteractive(root, async () => 'LIMPAR', () => {}), true);
  assert.deepEqual(await resetFiles(root), []);
  for (const path of protectedFiles) assert.equal(await readFile(join(root, path), 'utf8'), 'Preservar');
  await assert.rejects(lstat(join(root, 'Atlas', 'Subpasta')), {code:'ENOENT'});
  await assert.rejects(lstat(join(root, 'Digestões')), {code:'ENOENT'});
  assert.deepEqual(await readdir(join(root, 'Conteúdos Gerados')), ['README.md']);
  const executor = new Executor(root, config, { log() {} });
  await executor.initialize();
  assert.deepEqual(executor.state.jobs, []);
});

test('limpeza não segue links para arquivos ou pastas externos', async t => {
  const root = await setup(t);
  const outside = await mkdtemp(join(tmpdir(), '2brain-externo-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'registro.txt'), 'Conservar');
  await symlink(outside, join(root, 'Atlas', 'Link externo'));
  await resetInteractive(root, async () => 'LIMPAR', () => {});
  assert.equal(await readFile(join(outside, 'registro.txt'), 'utf8'), 'Conservar');
  await rm(join(root, 'Atlas'), { recursive: true });
  await symlink(outside, join(root, 'Atlas'));
  await assert.rejects(resetFiles(root), /sem links simbólicos/);
  assert.equal(await readFile(join(outside, 'registro.txt'), 'utf8'), 'Conservar');
});


test('limpeza remove pastas antigas, redes soltas, pedidos e subpastas dos recortes sem atingir pastas pessoais', async t => {
  const root = await setup(t);
  const dataDirectories = [
    'Geração de Conteúdos/Lotes/antigo', 'Digestões/antigo',
    'Conteúdos Gerados/LinkedIn', 'Conteúdos Gerados/Instagram', 'Conteúdos Gerados/Twitter',
    'Conteúdos Gerados/gen-teste-diario/Fontes', 'Conteúdos Gerados/gen-teste-diario/Twitter',
    'Recortes por Assunto/source-a', 'Diário/Registros', 'Diário/Dias', 'Diário/Grupos',
  ];
  for (const name of dataDirectories) {
    await mkdir(join(root,name),{recursive:true});
    await writeFile(join(root,name,'README.md'),'Documento gerado');
    await writeFile(join(root,name,'dados.json'),'{}');
  }
  await mkdir(join(root,'Meus documentos'),{recursive:true});
  await writeFile(join(root,'Meus documentos','pessoal.txt'),'Preservar');
  await writeFile(join(root,'Conteúdos Gerados','README.md'),'Orientação principal');
  for (const name of ['diario-registros.json','geracoes.json']) await writeFile(join(root,'sistema',name),'{}');
  assert.equal(await resetInteractive(root,async()=>'',()=>{}),false);
  assert.ok(await lstat(join(root,'Recortes por Assunto','source-a')));
  assert.equal(await resetInteractive(root,async()=>'LIMPAR',()=>{}),true);
  for (const name of dataDirectories) await assert.rejects(lstat(join(root,name)),{code:'ENOENT'});
  await assert.rejects(lstat(join(root,'Geração de Conteúdos')),{code:'ENOENT'});
  await assert.rejects(lstat(join(root,'sistema','geracoes.json')),{code:'ENOENT'});
  assert.deepEqual(await readdir(join(root,'Recortes por Assunto')),[]);
  assert.equal(await readFile(join(root,'Meus documentos','pessoal.txt'),'utf8'),'Preservar');
  assert.equal(await readFile(join(root,'Conteúdos Gerados','README.md'),'utf8'),'Orientação principal');
  await ensureFolders(root,{modular:true});
  await assert.rejects(lstat(join(root,'Geração de Conteúdos')),{code:'ENOENT'});
  await assert.rejects(lstat(join(root,'Digestões')),{code:'ENOENT'});
  assert.equal(await resetInteractive(root,async()=>'LIMPAR',()=>{}),true);
});
