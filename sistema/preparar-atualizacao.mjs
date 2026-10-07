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
  await writeFile(join(n8n, 'LEIA-ME.txt'), 'Abra cada arquivo .js, copie todo o conteúdo e cole no Code com o mesmo nome no workflow indicado (01 ou 02a). Publique os dois workflows depois de colar. Não precisa importar o workflow inteiro. Os Codes são completos; confira customizações locais antes de substituir. No 01, remova Schema — KeyTopics e Agent: Estruturar KeyTopics, se existir. Desative Require Specific Output Format no Agent: KeyTopics. Adicione um Code chamado Estruturar KeyTopics em JavaScript entre Agent: KeyTopics e Validar e montar digestão. Copie para ele o Code correspondente. Acrescente apenas as regras de formato Markdown do arquivo 01 - Formato Markdown KeyTopics.txt ao prompt atual, preservando suas instruções de análise e o modelo. Para as ramificações automáticas de 02a e 02b, siga CONTEUDOS-AUTOMATICOS.txt e os JSONs completos incluídos. O 03 permanece independente.\n');
  await writeFile(join(base, 'LEIA-ME.txt'), 'CLIENTE: pare o programa. Copie o CONTEÚDO de "Copiar para o cliente" para a raiz de cada cliente, onde está iniciar.bat. Mescle as pastas e substitua os arquivos. Não apague a pasta sistema. Reinicie e use opção 3 para retomar erros. Configuração, histórico e resultados não estão neste pacote.\n\nN8N: "Colar no n8n" contém Codes completos, nomeados pelos nodes. Aplique manualmente e publique.\n\nPRÓXIMAS ATUALIZAÇÕES: execute preparar-atualizacao.bat ou ./preparar-atualizacao.sh na cópia de desenvolvimento. A mesma pasta será atualizada com o código atual. Envie a pasta Copiar para o cliente ao sócio.\n');
  await writeFile(join(base, 'arquivos-do-programa.json'), JSON.stringify(files, null, 2) + '\n');
  return { base, files };
}

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./gerar-workflow.mjs');
  await import('./gerar-workflow-atlas.mjs');
  await import('./gerar-workflow-diario.mjs');
  // Keep full imports and standalone Codes in sync, without replacing custom prompts/models.
  for (const prefix of ['01-digestao', '02a-atlas']) {
    const directory = join(root, 'sistema', 'workflows');
    const specs = JSON.parse(await readFile(join(directory, prefix + '.nodes.json'), 'utf8'));
    const path = join(directory, prefix + '.importar.json');
    const workflow = JSON.parse(await readFile(path, 'utf8'));
    if (prefix === '01-digestao') {
      const removed = new Set(['Schema — KeyTopics', 'Agent: Estruturar KeyTopics']);
      workflow.nodes = workflow.nodes.filter(n => !removed.has(n.name));
      for (const name of removed) delete workflow.connections[name];
      for (const channels of Object.values(workflow.connections)) for (const batches of Object.values(channels)) {
        for (let i = 0; i < batches.length; i++) batches[i] = batches[i].filter(edge => !removed.has(edge.node));
      }
      const formatter = specs.find(n => n.name === 'Estruturar KeyTopics em JavaScript');
      if (!workflow.nodes.some(n => n.name === formatter.name)) workflow.nodes.push({ ...formatter, id: 'keytopics-markdown-code', position: [1100, 300] });
      const agent = workflow.nodes.find(n => n.name === 'Agent: KeyTopics');
      agent.parameters.hasOutputParser = false;
      const { keytopicsMarkdownInstructions } = await import('./keytopics-markdown.mjs');
      agent.parameters.options.systemMessage = agent.parameters.options.systemMessage.split('\n').filter(line => !line.startsWith('Retorne exclusivamente o JSON exigido pelo parser:')).join('\n');
      if (!agent.parameters.options.systemMessage.includes(keytopicsMarkdownInstructions)) agent.parameters.options.systemMessage += '\n\n' + keytopicsMarkdownInstructions;
      workflow.connections['Agent: KeyTopics'] = { main: [[{ node: formatter.name, type: 'main', index: 0 }]] };
      workflow.connections[formatter.name] = { main: [[{ node: 'Validar e montar digestão', type: 'main', index: 0 }]] };
    }
    for (const node of workflow.nodes) {
      const code = specs.find(spec => spec.name === node.name)?.parameters.jsCode;
      if (code) node.parameters.jsCode = code;
    }
    await writeFile(path, JSON.stringify(workflow, null, 2) + '\n');
  }
  const codes = [ ['01-digestao', 'Validar entrada e adicionar SEGs', '01-validar-entrada-segs.js'], ['01-digestao', 'Estruturar KeyTopics em JavaScript', '01-estruturar-keytopics.js'], ['01-digestao', 'Validar e montar digestão', '01-validar-digestao.js'], ['02a-atlas', 'Validar pedido do Atlas', '02a-compatibilidade-segs-1.js'], ['02a-atlas', 'Cortar texto deterministicamente', '02a-compatibilidade-segs-2.js'] ];
  for (const [prefix, name, output] of codes) {
    const directory = join(root, 'sistema', 'workflows');
    const specs = JSON.parse(await readFile(join(directory, prefix + '.nodes.json'), 'utf8'));
    await writeFile(join(directory, output), specs.find(n => n.name === name).parameters.jsCode + '\n');
  }
  const { extendLocalWorkflows } = await import('./estender-workflows-conteudos.mjs');
  await extendLocalWorkflows(root);
  const result = await prepareUpdate(root);
  for (const prefix of ['02a-atlas','02b-diario']) await copyFile(join(root,'sistema','workflows',prefix+'.importar.json'),join(result.base,'Colar no n8n',prefix+'.importar.json'));
  await writeFile(join(result.base,'Colar no n8n','CONTEUDOS-AUTOMATICOS.txt'),'02a e 02b agora possuem ramificações de conteúdo automático. Os JSONs .importar.json incluem o fluxo completo. Para preservar customizações de produção, copie apenas os nodes Contar palavras, Rotear conteúdo por palavras, quatro Agents e seus modelos, Estruturar conteúdo gerado e Reunir fluxo e conteúdo. Conecte a nova ramificação à saída true de Conhecimento aceito? (02a) ou Respostas Jev válidas? (02b). O Merge recebe o caminho original em input 1 e conteúdo em input 2, e continua no caminho original. Atualize também os Codes de conclusão conforme os JSONs. Publique. O modelo/credential de cada novo node deve ser configurado no n8n de produção. Atualize cada computador com a opção 9.\n');
  console.log('\nAtualização pronta em: ' + result.base + '\nCopie a pasta "Copiar para o cliente" para enviar ao sócio. Os Codes ficam em "Colar no n8n".');
}
