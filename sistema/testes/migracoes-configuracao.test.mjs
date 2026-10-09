import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDiaryWebhook } from '../migracoes-configuracao.mjs';
import { applyBundle, sha256 } from '../atualizador.mjs';
const legacy = '/webhook/segundo-cerebro-local-diario-v1';
const social = '/webhook/segundo-cerebro-local-diario-social-v2';
async function setup(t, diaryWebhook) {
  const root = await mkdtemp(join(tmpdir(), 'diary-config-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sistema'));
  const config = { diaryWebhook, n8nBaseUrl: 'https://servidor-do-cliente/n8n',
    digestWebhook: 'https://servidor-do-cliente/n8n/webhook/digest-personalizado',
    atlasWebhook: 'https://servidor-do-cliente/n8n/webhook/atlas-personalizado',
    aspectThreshold: 0.91, diaryRequestTimeoutMs: 123456, customField: { keep: true } };
  const text = JSON.stringify(config, null, 4) + '\n';
  await writeFile(join(root, 'sistema', 'configuracao.json'), text);
  await writeFile(join(root, 'sistema', 'diario.json'), 'histórico do cliente');
  return { root, config, text };
}
test('migra o webhook conhecido, preservando servidor, porta, prefixo, parâmetros e demais campos', async t => {
  for (const base of ['http://localhost:5678', 'https://n8n.socio.com', 'https://n8n.socio.com:8443/proxy/n8n']) {
    const { root, config, text } = await setup(t, base + legacy + '?cliente=abc#fragmento');
    const result = await migrateDiaryWebhook(root, config);
    assert.equal(result.migrated, true);
    assert.deepEqual(result.config, { ...config, diaryWebhook: base + social + '?cliente=abc#fragmento', diarySocialV2MigrationApplied: true });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8')), result.config);
    assert.equal(await readFile(join(root, 'Atualizações', 'Backups', 'migracao-diario-social-v2', 'configuracao.json'), 'utf8'), text);
    assert.equal(await readFile(join(root, 'sistema', 'diario.json'), 'utf8'), 'histórico do cliente');
  }
});
test('não altera endpoints personalizados, webhook de testes, URL inválida ou protocolo inesperado', async t => {
  for (const endpoint of ['https://socio/webhook/diario-customizado', 'https://socio/webhook-test/segundo-cerebro-local-diario-v1', 'https://socio' + legacy + '-custom', 'URL inválida', 'ftp://socio' + legacy]) {
    const { root, config, text } = await setup(t, endpoint);
    assert.deepEqual(await migrateDiaryWebhook(root, config), { config, migrated: false });
    assert.equal(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8'), text);
    assert.deepEqual(await readdir(root), ['sistema']);
  }
});
test('é aplicada uma vez; não sobrescreve o backup nem desfaz uma escolha posterior pelo legacy', async t => {
  const { root, config, text } = await setup(t, 'http://localhost:5678' + legacy);
  const first = await migrateDiaryWebhook(root, config);
  const written = await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8');
  assert.equal((await migrateDiaryWebhook(root, first.config)).migrated, false);
  assert.equal(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8'), written);
  const rollback = { ...first.config, diaryWebhook: config.diaryWebhook };
  await writeFile(join(root, 'sistema', 'configuracao.json'), JSON.stringify(rollback));
  assert.deepEqual(await migrateDiaryWebhook(root, rollback), { config: rollback, migrated: false });
  assert.equal(await readFile(join(root, 'Atualizações', 'Backups', 'migracao-diario-social-v2', 'configuracao.json'), 'utf8'), text);
});
test('v2 existente conserva a URL e registra a migração para permitir voltar ao legacy depois', async t => {
  const { root, config } = await setup(t, 'https://socio:443' + social);
  const result = await migrateDiaryWebhook(root, config);
  assert.equal(result.migrated, false);
  assert.equal(result.config.diaryWebhook, config.diaryWebhook);
  assert.equal(result.config.diarySocialV2MigrationApplied, true);
});
test('atualizador antigo instala o código sem tocar a configuração; a migração ocorre no próximo início', async t => {
  const { root, config } = await setup(t, 'https://socio/n8n' + legacy);
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.0.7' }));
  const paths = ['sistema/iniciar.mjs', 'sistema/atualizador.mjs', 'sistema/arquivos.mjs', 'sistema/migracoes-configuracao.mjs'];
  const files = [{ path: 'package.json', bytes: Buffer.from(JSON.stringify({ version: '1.0.8' })) }];
  for (const path of paths) files.push({ path, bytes: await readFile(new URL('../../' + path, import.meta.url)) });
  await applyBundle(root, { format: 1, version: '1.0.8', minNodeMajor: 22,
    files: files.map(({ path, bytes }) => ({ path, content: bytes.toString('base64'), sha256: sha256(bytes), mode: 0o644 })) });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'sistema', 'configuracao.json'), 'utf8')), config);
  const installed = await import(new URL('file://' + join(root, 'sistema', 'migracoes-configuracao.mjs')));
  const result = await installed.migrateDiaryWebhook(root, config);
  assert.deepEqual(result.config, { ...config, diaryWebhook: 'https://socio/n8n' + social, diarySocialV2MigrationApplied: true });
});
