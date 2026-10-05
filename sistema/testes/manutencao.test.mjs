import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
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
  assert.equal(saved.contentWebhook,'https://n8n.exemplo.com/n8n/webhook/segundo-cerebro-local-conteudos-v1');
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

test('limpeza confirmada apaga todos os dados e preserva configuração, código, exemplos e READMEs', async t => {
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
  assert.equal(await readFile(files[0], 'utf8'), '{}');
  assert.equal(await resetInteractive(root, async () => 'LIMPAR', () => {}), true);
  assert.deepEqual(await resetFiles(root), []);
  for (const path of protectedFiles) assert.equal(await readFile(join(root, path), 'utf8'), 'Preservar');
  assert.equal(await readFile(join(root, 'Atlas', 'Subpasta', 'README.md'), 'utf8'), 'Orientações internas');
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
