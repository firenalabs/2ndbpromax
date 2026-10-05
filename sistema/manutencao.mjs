import { lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { folders, writeJson } from './arquivos.mjs';
import { contentWebhookFor } from './conteudos.mjs';

export function configureN8n(config, address) {
  let value = address.trim();
  if (!value) throw new Error('Informe o endereço do n8n.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('Endereço inválido. Exemplo: https://n8n.exemplo.com'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Use uma URL http ou https, sem usuário, senha, parâmetros ou fragmentos.');
  }
  if (/\/webhook(?:-test)?(?:\/|$)/.test(url.pathname)) throw new Error('Informe a URL principal do n8n, sem o caminho /webhook.');
  const base = url.href.replace(/\/+$/, '');
  const result = { ...config, n8nBaseUrl: base };
  for (const key of ['digestWebhook', 'atlasWebhook', 'diaryWebhook']) {
    const endpoint = new URL(config[key]).pathname.match(/\/webhook\/(.+)$/)?.[1];
    if (!endpoint) throw new Error(`O caminho do webhook ${key} não foi encontrado na configuração.`);
    result[key] = `${base}/webhook/${endpoint}`;
  }
  const endpoint = new URL(contentWebhookFor(config)).pathname.match(/\/webhook\/(.+)$/)?.[1];
  result.contentWebhook = `${base}/webhook/${endpoint}`;
  return result;
}

export function currentN8nUrl(config) {
  return config.n8nBaseUrl ?? config.digestWebhook.split('/webhook/')[0];
}

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function resetFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name !== 'README.md') files.push(path);
    }
  }
  for (const folder of Object.values(folders)) {
    const directory = join(root, folder);
    const stat = await exists(directory);
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`A pasta ${folder} deve ser uma pasta local, sem links simbólicos, para realizar a limpeza.`);
    await visit(directory);
  }
  const system = await exists(join(root, 'sistema'));
  if (system && (!system.isDirectory() || system.isSymbolicLink())) throw new Error('A pasta sistema deve ser uma pasta local para realizar a limpeza.');
  for (const name of ['estado.json', 'estado.json.tmp', 'diario.json', 'diario.json.tmp']) {
    const path = join(root, 'sistema', name);
    const stat = await exists(path);
    if (stat) {
      if (stat.isDirectory()) throw new Error(`O arquivo sistema/${name} foi substituído por uma pasta. Corrija isso antes de limpar.`);
      files.push(path);
    }
  }
  return files;
}

export async function configureInteractive(root, config, ask, log = console.log) {
  log(`\nEndereço atual do n8n: ${currentN8nUrl(config)}`);
  const answer = await ask('Novo endereço (ex.: https://n8n.exemplo.com; Enter cancela): ');
  if (!answer.trim()) { log('Configuração mantida.'); return; }
  const updated = configureN8n(config, answer);
  await writeJson(join(root, 'sistema', 'configuracao.json'), updated);
  log(`\nEndereço salvo: ${updated.n8nBaseUrl}\nOs quatro fluxos usarão esse endereço na próxima execução.`);
  log('Nesse n8n, os quatro workflows precisam estar publicados, com os mesmos caminhos de webhook e credenciais OpenRouter configuradas.');
}

export async function resetInteractive(root, ask, log = console.log) {
  const files = await resetFiles(root);
  log(`\nLimpeza local: ${files.length} arquivo(s) serão apagados em:\n${Object.values(folders).join(', ')} e histórico em sistema.`);
  log('Inclui os textos ainda na Entrada e o grupo aberto do Diário. A exclusão não pode ser desfeita.');
  log('Código, configuração, exemplos, workflows e READMEs serão mantidos. O n8n não será apagado.');
  const answer = await ask('Digite LIMPAR para apagar tudo isso (Enter cancela): ');
  if (answer.trim() !== 'LIMPAR') { log('Limpeza cancelada. Nenhum arquivo foi apagado.'); return false; }
  for (const path of files) await unlink(path);
  log('\nDados locais apagados. Inicie novamente e coloque novos textos na Entrada.');
  return true;
}
