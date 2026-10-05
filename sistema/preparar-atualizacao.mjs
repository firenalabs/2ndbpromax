import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only explicitly selected program files enter the delivery; client data never does.
export async function prepareUpdate(root) {
  const base = join(root, 'Atualizações', 'Atualizacao atual');
  const client = join(base, 'Copiar para o cliente');
  const n8n = join(base, 'Colar no n8n');
  const runtime = (await readdir(join(root, 'sistema'))).filter(name => name.endsWith('.mjs')).sort();
  const files = runtime.map(name => 'sistema/' + name).concat(['iniciar.bat', 'iniciar.sh', 'package.json', 'README.md', 'LEIA-ME-ATUALIZACAO.md', 'sistema/README.md']);
  await mkdir(join(client, 'sistema'), { recursive: true });
  await mkdir(n8n, { recursive: true });
  for (const name of files) await copyFile(join(root, name), join(client, name));
  const codes = [
    ['01-digestao.nodes.json', 'Validar entrada e adicionar SEGs', '01 - Validar entrada e adicionar SEGs.js'],
    ['01-digestao.nodes.json', 'Validar e montar digestão', '01 - Validar e montar digestão.js'],
    ['02a-atlas.nodes.json', 'Validar pedido do Atlas', '02a - Validar pedido do Atlas.js'],
    ['02a-atlas.nodes.json', 'Cortar texto deterministicamente', '02a - Cortar texto deterministicamente.js'],
  ];
  for (const [definition, name, destination] of codes) {
    const nodes = JSON.parse(await readFile(join(root, 'sistema', 'workflows', definition), 'utf8'));
    const code = nodes.find(node => node.name === name)?.parameters.jsCode;
    if (!code) throw new Error('Code não encontrado para atualização: ' + name);
    await writeFile(join(n8n, destination), code + '\n');
  }
  await copyFile(join(root, 'sistema', 'workflows', 'keytopics.prompt.txt'), join(n8n, '01 - Prompt KeyTopics.txt'));
  await writeFile(join(n8n, 'LEIA-ME.txt'), 'Abra cada arquivo .js, copie todo o conteúdo e cole no Code com o mesmo nome no workflow indicado (01 ou 02a). Publique os dois workflows depois de colar. Não precisa importar o workflow inteiro. Os Codes são completos; confira customizações locais antes de substituir. O prompt é uma referência para transcrições, não precisa substituir um prompt já customizado. 02b e 03 não mudam nesta atualização.\n');
  await writeFile(join(base, 'LEIA-ME.txt'), 'CLIENTE: pare o programa. Copie o CONTEÚDO de "Copiar para o cliente" para a raiz de cada cliente, onde está iniciar.bat. Mescle as pastas e substitua os arquivos. Não apague a pasta sistema. Reinicie e use opção 3 para retomar erros. Configuração, histórico e resultados não estão neste pacote.\n\nN8N: "Colar no n8n" contém Codes completos, nomeados pelos nodes. Aplique manualmente e publique.\n\nPRÓXIMAS ATUALIZAÇÕES: execute preparar-atualizacao.bat ou ./preparar-atualizacao.sh na cópia de desenvolvimento. A mesma pasta será atualizada com o código atual. Envie a pasta Copiar para o cliente ao sócio.\n');
  await writeFile(join(base, 'arquivos-do-programa.json'), JSON.stringify(files, null, 2) + '\n');
  return { base, files };
}

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./gerar-workflow.mjs');
  await import('./gerar-workflow-atlas.mjs');
  // Keep full imports and standalone Codes in sync, without replacing custom prompts/models.
  for (const prefix of ['01-digestao', '02a-atlas']) {
    const directory = join(root, 'sistema', 'workflows');
    const specs = JSON.parse(await readFile(join(directory, prefix + '.nodes.json'), 'utf8'));
    const path = join(directory, prefix + '.importar.json');
    const workflow = JSON.parse(await readFile(path, 'utf8'));
    for (const node of workflow.nodes) {
      const code = specs.find(spec => spec.name === node.name)?.parameters.jsCode;
      if (code) node.parameters.jsCode = code;
    }
    await writeFile(path, JSON.stringify(workflow, null, 2) + '\n');
  }
  const codes = [ ['01-digestao', 'Validar entrada e adicionar SEGs', '01-validar-entrada-segs.js'], ['01-digestao', 'Validar e montar digestão', '01-validar-digestao.js'], ['02a-atlas', 'Validar pedido do Atlas', '02a-compatibilidade-segs-1.js'], ['02a-atlas', 'Cortar texto deterministicamente', '02a-compatibilidade-segs-2.js'] ];
  for (const [prefix, name, output] of codes) {
    const directory = join(root, 'sistema', 'workflows');
    const specs = JSON.parse(await readFile(join(directory, prefix + '.nodes.json'), 'utf8'));
    await writeFile(join(directory, output), specs.find(n => n.name === name).parameters.jsCode + '\n');
  }
  const result = await prepareUpdate(root);
  console.log('\nAtualização pronta em: ' + result.base + '\nCopie a pasta "Copiar para o cliente" para enviar ao sócio. Os Codes ficam em "Colar no n8n".');
}
