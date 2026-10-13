import { lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { folders, writeJson } from './arquivos.mjs';
import { terminalLog } from './terminal.mjs';

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
  const { contentWebhook: retiredWebhook, ...currentConfig } = config;
  const result = { ...currentConfig, n8nBaseUrl: base };
  for (const key of ['digestWebhook', 'atlasWebhook', 'diaryWebhook', ...(config.generationWebhook ? ['generationWebhook'] : [])]) {
    const endpoint = new URL(config[key]).pathname.match(/\/webhook\/(.+)$/)?.[1];
    if (!endpoint) throw new Error(`O caminho do webhook ${key} não foi encontrado na configuração.`);
    result[key] = `${base}/webhook/${endpoint}`;
  }
  return result;
}

export function currentN8nUrl(config) {
  return config.n8nBaseUrl ?? config.digestWebhook.split('/webhook/')[0];
}

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export const retiredDataFolders = ['Digestões', 'Geração de Conteúdos'];
const resetRoots = [...new Set([...Object.values(folders), ...retiredDataFolders])];

export async function resetPlan(root) {
  const files = [], directories = [], roots = [];
  async function visit(directory, preserveRootReadme = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        directories.push(path);
      } else if (!(preserveRootReadme && entry.isFile() && entry.name === 'README.md')) files.push(path);
    }
  }
  for (const folder of resetRoots) {
    const directory = join(root, folder);
    const stat = await exists(directory);
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`A pasta ${folder} deve ser uma pasta local, sem links simbólicos, para realizar a limpeza.`);
    roots.push(directory);
    const retired = retiredDataFolders.includes(folder);
    await visit(directory, !retired);
    if (retired) directories.push(directory);
  }
  const system = await exists(join(root, 'sistema'));
  if (system && (!system.isDirectory() || system.isSymbolicLink())) throw new Error('A pasta sistema deve ser uma pasta local para realizar a limpeza.');
  for (const name of ['estado.json', 'estado.json.tmp', 'diario.json', 'diario.json.tmp', 'diario-registros.json', 'diario-registros.json.tmp', 'geracoes.json', 'geracoes.json.tmp']) {
    const path = join(root, 'sistema', name);
    const stat = await exists(path);
    if (stat) {
      if (stat.isDirectory()) throw new Error(`O arquivo sistema/${name} foi substituído por uma pasta. Corrija isso antes de limpar.`);
      files.push(path);
    }
  }
  return { files, directories, roots };
}

export async function resetFiles(root) { return (await resetPlan(root)).files; }

export async function configureInteractive(root, config, ask, log = terminalLog) {
  log(`\nEndereço atual do n8n: ${currentN8nUrl(config)}`);
  const answer = await ask('Novo endereço (ex.: https://n8n.exemplo.com; Enter cancela): ');
  if (!answer.trim()) { log('Configuração mantida.'); return; }
  const updated = configureN8n(config, answer);
  await writeJson(join(root, 'sistema', 'configuracao.json'), updated);
  log(`\nEndereço salvo: ${updated.n8nBaseUrl}\nOs fluxos usarão esse endereço na próxima execução.`);
  log('Nesse n8n, os workflows precisam estar publicados, com os mesmos caminhos de webhook e credenciais OpenRouter configuradas.');
}

export async function resetInteractive(root, ask, log = terminalLog) {
  const plan = await resetPlan(root);
  log(`\nLimpeza local: ${plan.files.length} arquivo(s) e ${plan.directories.length} pasta(s) serão apagados em:\n${resetRoots.join(', ')} e histórico em sistema.`);
  log('Inclui os textos na Entrada, registros do Diário, recortes, pedidos e conteúdos gerados. A exclusão não pode ser desfeita.','warning');
  log('Subpastas dos dados serão removidas. Pastas antigas Digestões e Geração de Conteúdos serão removidas por completo.');
  log('Código, configuração, exemplos e READMEs da raiz das pastas ativas serão mantidos. O n8n não será apagado.');
  const answer = await ask('Digite LIMPAR para apagar tudo isso (Enter cancela): ');
  if (answer.trim() !== 'LIMPAR') { log('Limpeza cancelada. Nenhum arquivo ou pasta foi apagado.'); return false; }
  const confirmed = await resetPlan(root);
  for (const directory of [...confirmed.roots, ...confirmed.directories]) {
    const stat = await exists(directory);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Uma pasta mudou durante a confirmação. Reinicie a limpeza.');
  }
  for (const path of confirmed.files) await unlink(path);
  for (const path of confirmed.directories) await rmdir(path);
  log('\nDados e subpastas locais apagados. Inicie novamente e coloque novos textos na Entrada.');
  return true;
}
