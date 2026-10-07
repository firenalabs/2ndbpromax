import { structureAutomaticContent } from './conteudos-automaticos.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function extendContentWorkflow(workflow, origin) {
  const w = structuredClone(workflow), atlas = origin === 'atlas';
  const label = atlas ? 'Atlas' : 'Diário';
  const names = { count: `Contar palavras para conteúdo — ${label}`, router: `Rotear conteúdo por palavras — ${label}`,
    result: `Estruturar conteúdo gerado — ${label}`, merge: `Reunir fluxo e conteúdo — ${label}` };
  if (w.nodes.some(n => n.name === names.count)) {
    for (const n of w.nodes) {
      let code=n.parameters?.jsCode;
      if (!code || code.includes('generatedContents:')) continue;
      if (n.name==='Concluir recorte e atualizar Atlas') code=code.replace('block:input.block,','generatedContents:input.generatedContents??[],generatedContentErrors:input.generatedContentErrors??[],block:input.block,');
      if (n.name==='Montar resultado completo do Atlas') code=code.replace('ok:true,blocks:','ok:true,generatedContents:items.flatMap(i=>i.generatedContents??[]),generatedContentErrors:items.flatMap(i=>i.generatedContentErrors??[]),blocks:');
      if (n.name==='Montar Diário e Conquistas completos') code=code.replace('ok: true, aspects:','ok: true, generatedContents:first.generatedContents??[], generatedContentErrors:first.generatedContentErrors??[], aspects:');
      n.parameters.jsCode=code;
    }
    return w;
  }
  const gate = atlas ? 'Conhecimento aceito?' : 'Respostas Jev válidas?';
  const original = atlas ? 'Montar nota preparada' : 'Validar título e resumo';
  const next = atlas ? 'Nota preparada válida?' : 'Preparar ações dos aspectos true';
  const base = w.nodes.find(n => n.name === original).position;
  const x = base[0], y = Math.max(...w.nodes.filter(n => !/stickyNote/.test(n.type)).map(n => n.position[1])) + 400;
  const added = [];
  const add = (name, type, typeVersion, parameters, position, extra = {}) => { const n = { id: `auto-${origin}-${added.length}`, name, type, typeVersion, parameters, position, ...extra }; added.push(n); return n; };
  const connect = (source, target, sourceIndex = 0, index = 0, type = 'main') => {
    const channels = w.connections[source] ??= {}; const outputs = channels[type] ??= [];
    outputs[sourceIndex] ??= []; outputs[sourceIndex].push({ node: target, type, index });
  };
  add(names.count, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: `const context=$input.first().json;\nconst text=${atlas ? 'context.block.text' : 'context.text'};\nreturn [{json:{text,referenceId:${atlas ? 'context.block.id' : 'context.groupId'},contentTitle:${atlas ? 'context.block.keytopic' : "'Conteúdo do Diário'"},contentSourceIds:${atlas ? '[context.block.sourceId]' : 'context.sourceIds'},sourceWordCount:(text.match(/\\S+/g)??[]).length}}];` }, [x, y]);
  const ranges = [[0,150,'0–150'],[151,600,'151–600'],[601,1499,'601–1499'],[1500,null,'1500+']];
  const rules = ranges.map(([min,max,key]) => ({ renameOutput: true, outputKey: `${key} palavras`, conditions: {
    options: { caseSensitive: false, leftValue: '', typeValidation: 'strict', version: 3 }, combinator: 'and',
    conditions: [{ leftValue: '={{ $json.sourceWordCount }}', rightValue: min, operator: { type: 'number', operation: 'gte' } },
      ...(max === null ? [] : [{ leftValue: '={{ $json.sourceWordCount }}', rightValue: max, operator: { type: 'number', operation: 'lte' } }])] } }));
  add(names.router, 'n8n-nodes-base.switch', 3.4, { mode: 'rules', rules: { values: rules }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'Sem faixa — continuar', allMatchingOutputs: false } }, [x+260,y]);
  const model = w.nodes.find(n => n.type.endsWith('.lmChatOpenRouter'));
  ranges.forEach(([, ,key], i) => {
    const agent = `Agent: Conteúdo ${label} — ${key}`, modelName = `OpenRouter — Conteúdo ${label} ${key}`;
    add(agent, '@n8n/n8n-nodes-langchain.agent', 3.1, { promptType: 'define', text: '={{ $json.text }}', hasOutputParser: false,
      options: { systemMessage: `[CRIADO POR CODEX — conteúdo automático ${origin} — ${key}]\nProduza um conteúdo em português baseado no texto recebido, preservando os fatos. Comece com um título Markdown (# Título). Retorne o conteúdo em Markdown. Esta configuração inicial pode ser personalizada.`, maxIterations: 2 } }, [x+560,y+i*220], { onError: 'continueRegularOutput', notes: 'Personalize livremente o prompt e o modelo. Não precisa de Output Parser. O Code seguinte estrutura o resultado.' });
    add(modelName, model.type, model.typeVersion, structuredClone(model.parameters), [x+560,y+i*220+100], model.credentials ? { credentials: structuredClone(model.credentials) } : {});
    connect(names.router, agent, i); connect(modelName,agent,0,0,'ai_languageModel'); connect(agent,names.result);
  });
  add(names.result, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: `${structureAutomaticContent.toString()}\nconst context=$(${JSON.stringify(names.count)}).item.json;\nreturn [{json:structureAutomaticContent($input.first().json,context,${JSON.stringify(origin)})}];` }, [x+900,y+330]);
  add(names.merge, 'n8n-nodes-base.merge', 3.2, { mode: 'combine', combineBy: 'combineByPosition', numberInputs: 2, options: {} }, [base[0]+180,base[1]], { notes: 'Aguarda o caminho original e a geração de conteúdo. Falhas do novo Agent chegam como generatedContentErrors, sem impedir a continuidade.' });
  add(`Guia — Conteúdos ${label}`, 'n8n-nodes-base.stickyNote', 1, { content: `## Conteúdos Gerados — ${label}\nRamificação automática após ${gate} = true.\nContagem → faixa → um Agent → estruturação em JS → reunião com o fluxo original.\nPersonalize as condições do Switch e cada Agent/modelo separadamente. Sem faixa ou erro do Agent: continuar. O computador salva .md e .json em Conteúdos Gerados, na mesma resposta do fluxo.`, width: 1320, height: 240, color: 6 }, [x-60,y-280]);
  connect(gate,names.count); connect(names.count,names.router); connect(names.router,names.result,4); connect(names.result,names.merge,0,1);
  w.connections[original].main[0] = w.connections[original].main[0].filter(e => e.node !== next);
  connect(original,names.merge); connect(names.merge,next);
  const patch = (name, transform) => { const n=w.nodes.find(n=>n.name===name); n.parameters.jsCode=transform(n.parameters.jsCode); };
  if (atlas) {
    patch('Concluir recorte e atualizar Atlas', code=>code.replace('block:input.block,', 'generatedContents:input.generatedContents??[],generatedContentErrors:input.generatedContentErrors??[],block:input.block,'));
    patch('Montar resultado completo do Atlas', code=>code.replace('ok:true,blocks:', 'ok:true,generatedContents:items.flatMap(i=>i.generatedContents??[]),generatedContentErrors:items.flatMap(i=>i.generatedContentErrors??[]),blocks:'));
  } else patch('Montar Diário e Conquistas completos', code=>code.replace('ok: true, aspects:', 'ok: true, generatedContents:first.generatedContents??[], generatedContentErrors:first.generatedContentErrors??[], aspects:'));
  w.nodes.push(...added); return w;
}

export async function extendLocalWorkflows(root) {
  for (const [prefix,origin] of [['02a-atlas','atlas'],['02b-diario','diario']]) {
    const path = `${root}/sistema/workflows/${prefix}.importar.json`;
    const w = extendContentWorkflow(JSON.parse(await readFile(path,'utf8')),origin);
    await writeFile(path,JSON.stringify(w,null,2)+'\n');
    const specsPath = `${root}/sistema/workflows/${prefix}.nodes.json`;
    const specs = JSON.parse(await readFile(specsPath,'utf8'));
    for (const n of w.nodes) {
      const spec=specs.find(s=>s.name===n.name);
      if(spec?.parameters.jsCode) spec.parameters.jsCode=n.parameters.jsCode;
      if(!spec) specs.push(n);
    }
    await writeFile(specsPath,JSON.stringify(specs,null,2)+'\n');
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await extendLocalWorkflows(fileURLToPath(new URL('../',import.meta.url)));
