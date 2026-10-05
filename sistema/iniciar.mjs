import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { readJson, writeJson, ensureFolders } from './arquivos.mjs';
import { updateSystem } from './atualizador.mjs';
import { Executor, acquireLock } from './executor.mjs';
import { configureInteractive, resetInteractive, currentN8nUrl } from './manutencao.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let release;
let executor;
let menu;
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Instale Node.js 22 ou superior para iniciar.');
  let config = await readJson(join(root, 'sistema', 'configuracao.json'), null);
  if (!config) {
    config = await readJson(join(root, 'sistema', 'configuracao.exemplo.json'), null);
    if (config) { await writeJson(join(root, 'sistema', 'configuracao.json'), config); console.log('Configuração inicial criada. Use a opção 6 para informar o endereço do n8n.'); }
  }
  if (!config?.digestWebhook) throw new Error('A configuração do workflow não foi encontrada em sistema/configuracao.json.');
  console.log(`\nn8n configurado: ${currentN8nUrl(config)}`);
  await ensureFolders(root);
  release = await acquireLock(root);
  let mode = process.argv[2];
  if (!mode && process.stdin.isTTY) {
    console.log('\nSegundo cérebro — protótipo local\n\n1. Iniciar e aguardar novos textos\n2. Processar os textos que já estão na Entrada\n3. Tentar novamente os textos com erro\n4. Ver o andamento\n5. Ignorar o primeiro texto com erro e seguir\n6. Configurar endereço do n8n\n7. Limpar dados e começar de novo\n8. Gerar conteúdos dos grupos concluídos\n9. Atualizar sistema\n');
    menu = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await menu.question('Escolha uma opção [1]: ');
    mode = ({ '': '--escutar', '1': '--escutar', '2': '--lote', '3': '--tentar-novamente', '4': '--status', '5': '--ignorar-erro', '6': '--configurar-n8n', '7': '--limpar', '8': '--gerar-conteudos', '9': '--atualizar' })[answer.trim()];
    if (!mode) throw new Error('Escolha uma opção de 1 a 9.');
  }
  mode ??= '--escutar';
  if (!['--escutar', '--lote', '--tentar-novamente', '--status', '--ignorar-erro', '--configurar-n8n', '--limpar', '--gerar-conteudos', '--atualizar'].includes(mode)) throw new Error('Opção desconhecida. Inicie sem argumentos para abrir o menu.');
  if (['--configurar-n8n', '--limpar'].includes(mode)) {
    if (!process.stdin.isTTY) throw new Error('Abra um terminal interativo para configurar ou confirmar a limpeza.');
    menu ??= createInterface({ input: process.stdin, output: process.stdout });
    const ask = question => menu.question(question);
    if (mode === '--configurar-n8n') await configureInteractive(root, config, ask);
    else await resetInteractive(root, ask);
  } else if (mode === '--atualizar') {
    menu?.close();
    await updateSystem(root);
  } else {
    menu?.close();
    executor = new Executor(root, config);
    await executor.initialize();
    const stop = () => { executor.stopping = true; console.log('\nParando após o texto em andamento…'); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(`\nArquivos e resultados: ${root}\n`);
    if (mode === '--gerar-conteudos') { await executor.diary.generatePendingContents(); executor.showStatus(); }
    else if (mode === '--status') executor.showStatus();
    else if (mode === '--ignorar-erro') await executor.ignoreFirstError();
    else if (mode === '--escutar') await executor.watch();
    else await executor.batch({ retry: mode === '--tentar-novamente' });
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  menu?.close();
  if (release) await release();
}
