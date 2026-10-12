import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJson } from './arquivos.mjs';

export const retiredManualContentPaths = [
  'sistema/conteudos.mjs',
  'sistema/testes/conteudos.test.mjs',
  'sistema/workflows/03-conteudos.sdk.js',
  'sistema/workflows/03-conteudos.importar.json',
];

// Older updaters merge files, so retire unused program files on restart too.
// User documents and processing history are never removed.
export async function retireManualContentGeneration(root, config) {
  for (const path of retiredManualContentPaths) {
    await unlink(join(root, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  if (!Object.hasOwn(config, 'contentWebhook')) return config;
  const { contentWebhook: retiredWebhook, ...updated } = config;
  await writeJson(join(root, 'sistema', 'configuracao.json'), updated);
  return updated;
}

// Runs on restart, including when an older updater installed the new code.
export async function migrateDiaryWebhook(root, config) {
  if (config.diarySocialV2MigrationApplied === true) return { config, migrated: false };
  let url;
  try { url = new URL(config.diaryWebhook); } catch { return { config, migrated: false }; }
  const legacy = '/webhook/segundo-cerebro-local-diario-v1';
  const social = '/webhook/segundo-cerebro-local-diario-social-v2';
  if (!['http:', 'https:'].includes(url.protocol)
    || (!url.pathname.endsWith(legacy) && !url.pathname.endsWith(social))) return { config, migrated: false };

  const migrated = url.pathname.endsWith(legacy);
  if (migrated) url.pathname = url.pathname.slice(0, -legacy.length) + social;
  const updated = { ...config, diaryWebhook: migrated ? url.href : config.diaryWebhook,
    diarySocialV2MigrationApplied: true };
  const path = join(root, 'sistema', 'configuracao.json');
  const backup = join(root, 'Atualizações', 'Backups', 'migracao-diario-social-v2');
  const original = await readFile(path);
  await mkdir(backup, { recursive: true });
  try { await writeFile(join(backup, 'configuracao.json'), original, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await writeJson(path, updated);
  return { config: updated, migrated };
}
