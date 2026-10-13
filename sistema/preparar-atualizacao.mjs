import { readdir, mkdir, copyFile, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { retiredManualContentPaths } from './migracoes-configuracao.mjs';

// Only explicitly selected program files enter the delivery; client data never does.
export async function prepareUpdate(root) {
  const base = join(root, 'Atualizações', 'Atualizacao atual');
  const client = join(base, 'Copiar para o cliente');
  const n8n = join(base, 'Colar no n8n');
  const runtime = (await readdir(join(root, 'sistema'))).filter(name => name.endsWith('.mjs')).sort();
  const files = runtime.map(name => 'sistema/' + name).concat(['iniciar.bat', 'iniciar.sh', 'package.json', 'README.md', 'LEIA-ME-ATUALIZACAO.md', 'sistema/README.md']);
  await mkdir(join(client, 'sistema'), { recursive: true });
  await mkdir(n8n, { recursive: true });
  for (const path of retiredManualContentPaths) await unlink(join(client, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  for (const name of ['03-conteudos.importar.json', '03-conteudos.sdk.js']) await unlink(join(n8n, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  for (const name of files) await copyFile(join(root, name), join(client, name));
  const modular = await readFile(join(root,'sistema','workflows','03-editorial.importar.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if (modular) {
    for (const prefix of ['01-digestao','02a-atlas','02b-diario-registros','03-editorial']) await copyFile(join(root,'sistema','workflows',prefix+'.importar.json'),join(n8n,prefix+'.importar.json'));
    const atlas=JSON.parse(await readFile(join(n8n,'02a-atlas.importar.json'),'utf8'));
    const titleCode=atlas.nodes.find(n=>n.name==='Montar nota preparada').parameters.jsCode;
    const titleSchema=atlas.nodes.find(n=>n.name==='Schema — Título da nota').parameters.inputSchema;
    await writeFile(join(n8n,'02a - Montar nota preparada.js'),titleCode+'\n');
    await writeFile(join(n8n,'02a - Schema Título da nota.json'),JSON.stringify(JSON.parse(titleSchema),null,2)+'\n');
    await writeFile(join(n8n,'02a - CORREÇÃO TÍTULO.txt'),'Para corrigir títulos longos sem substituir o workflow: no Schema — Título da nota, cole o JSON do schema no Input Schema. No Code Montar nota preparada, cole o JavaScript completo. Preserve conexões, agentes, modelos e publique. Títulos acima de 150 caracteres são abreviados entre palavras; originalTitle mantém o original no recorte salvo pelo Atlas. A opção 9 não atualiza o servidor n8n.\n');
    await writeFile(join(n8n,'LEIA-ME.txt'),'Cadeia modular: importe os quatro workflows JSON, configure as credenciais OpenRouter e publique. O 01 prepara KeyTopics e recortes; 02a organiza Atlas; 02b registra cada input; 03 gera conteúdos. Preserve cópias anteriores. Despublique versões antigas que usem os mesmos webhooks antes de publicar substitutos. Não importe o workflow de teste. A atualização do programa não atualiza automaticamente o servidor n8n.\n');
    await writeFile(join(base,'LEIA-ME.txt'),'Pare o programa. Mescle Copiar para o cliente na instalação, preservando configuração e dados. Atualize também os quatro workflows do servidor conforme Colar no n8n. Opção 1 prepara e registra; opção 2 gera recortes pendentes; opção 3 gera grupos dos registros de um dia.\n');
    await writeFile(join(base,'arquivos-do-programa.json'),JSON.stringify(files,null,2)+'\n');
    return {base,files};
  }
  const codes = [
    ['01-digestao.nodes.json', 'Validar entrada e adicionar SEGs', '01 - Validar entrada e adicionar SEGs.js'],
    ['01-digestao.nodes.json', 'Estruturar KeyTopics em JavaScript', '01 - Estruturar KeyTopics em JavaScript.js'],
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
  const { keytopicsMarkdownInstructions } = await import('./keytopics-markdown.mjs');
  await writeFile(join(n8n, '01 - Formato Markdown KeyTopics.txt'), keytopicsMarkdownInstructions + '\n');
  await copyFile(join(root, 'sistema', 'workflows', 'keytopics.prompt.txt'), join(n8n, '01 - Prompt KeyTopics.txt'));
  // Social workflow is a separate import; never replaces the legacy 02b.
  try { await copyFile(join(root, 'sistema', 'workflows', '02b-diario-social.importar.json'), join(n8n, '02b-diario-social.importar.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(join(n8n, 'LEIA-ME.txt'), 'Abra cada arquivo .js, copie todo o conteúdo e cole no Code com o mesmo nome no workflow indicado (01 ou 02a). Publique os dois workflows depois de colar. Não precisa importar o workflow inteiro. Os Codes são completos; confira customizações locais antes de substituir. No 01, remova Schema — KeyTopics e Agent: Estruturar KeyTopics, se existir. Desative Require Specific Output Format no Agent: KeyTopics. Adicione um Code chamado Estruturar KeyTopics em JavaScript entre Agent: KeyTopics e Validar e montar digestão. Copie para ele o Code correspondente. Acrescente apenas as regras de formato Markdown do arquivo 01 - Formato Markdown KeyTopics.txt ao prompt atual, preservando suas instruções de análise e o modelo. Para as ramificações automáticas de 02a e 02b, siga CONTEUDOS-AUTOMATICOS.txt e os JSONs completos incluídos.\n');
  await writeFile(join(base, 'LEIA-ME.txt'), 'CLIENTE: pare o programa. Copie o CONTEÚDO de "Copiar para o cliente" para a raiz de cada cliente, onde está iniciar.bat. Mescle as pastas e substitua os arquivos. Não apague a pasta sistema. Reinicie e use opção 1 para retomar erros e aguardar novos textos. Configuração, histórico e resultados não estão neste pacote.\n\nN8N: "Colar no n8n" contém Codes completos, nomeados pelos nodes. Aplique manualmente e publique.\n\nPRÓXIMAS ATUALIZAÇÕES: execute preparar-atualizacao.bat ou ./preparar-atualizacao.sh na cópia de desenvolvimento. A mesma pasta será atualizada com o código atual. Envie a pasta Copiar para o cliente ao sócio.\n');
  await writeFile(join(base, 'arquivos-do-programa.json'), JSON.stringify(files, null, 2) + '\n');
  return { base, files };
}

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {writeModular}=await import('./workflows/build-modular.mjs');
  await writeModular();
  const result=await prepareUpdate(root);
  console.log('Atualização modular pronta em: '+result.base);
}
