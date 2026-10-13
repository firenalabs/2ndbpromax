import { readFile, writeFile } from 'node:fs/promises';
import { validateDigest } from '../contratos.mjs';
import { buildBlocks } from '../contratos-atlas.mjs';
import { normalizeEditorial, validEditorialCheckpoint } from '../outputs-editoriais.mjs';
import { simplifyEditorial } from './simplificar-editorial.mjs';
import { diaryWithoutLoop } from './diario-sem-loop.mjs';
import { organizeAtlas } from './atlas-organizado.mjs';
import { fixAtlasTitle } from './titulo-atlas.mjs';
import { bragBySegments } from './brag-por-segmentos.mjs';
import { fixImageJevBodies } from './jevs-imagens-validos.mjs';

const read = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const prune = (w, names) => {
  w.nodes = w.nodes.filter(n => !names.has(n.name));
  for (const name of names) delete w.connections[name];
  for (const channels of Object.values(w.connections)) for (const batches of Object.values(channels)) for (let i = 0; i < batches.length; i++) batches[i] = batches[i].filter(e => !names.has(e.node));
};
const edge = (w, source, target, output = 0, input = 0, type = 'main') => {
  w.connections[source] ??= {}; w.connections[source][type] ??= [];
  while (w.connections[source][type].length <= output) w.connections[source][type].push([]);
  w.connections[source][type][output].push({ node: target, type, index: input });
};
const addCode = (w, name, jsCode, position = [0, 0]) => w.nodes.push({ name, id: name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode } });
const addIf = (w, name, leftValue, position) => w.nodes.push({ name, id: name, type: 'n8n-nodes-base.if', typeVersion: 2.3, position,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ leftValue, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} } });
const webhook = name => ({ name, type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [-1200, 0], parameters: { httpMethod: 'POST', path: 'segundo-cerebro-local-conteudos-v1', responseMode: 'responseNode', options: {} } });
const response = name => ({ name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [4000, 0], parameters: { respondWith: 'firstIncomingItem', options: { enableStreaming: false } } });
export function sdkCode(w) {
  const index = new Map(w.nodes.map((n, i) => [n.name, 'n' + i]));
  const serialize = v => {
    if (typeof v === 'string' && v.startsWith('=') && v.includes('{{')) return `expr(${JSON.stringify(v.slice(1))})`;
    if (Array.isArray(v)) return '[' + v.map(serialize).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, val]) => JSON.stringify(k) + ':' + serialize(val)).join(',') + '}';
    return JSON.stringify(v);
  };
  const lines = ["import { workflow, node, trigger, languageModel, outputParser, newCredential, expr } from '@n8n/workflow-sdk';"];
  const ordered = [...w.nodes.filter(n => /lmChat|outputParser/.test(n.type)), ...w.nodes.filter(n => !/lmChat|outputParser/.test(n.type))];
  for (const n of ordered) {
    const factory = n.type.endsWith('.webhook') ? 'trigger' : n.type.includes('lmChat') ? 'languageModel' : n.type.includes('outputParser') ? 'outputParser' : 'node';
    const config = { name: n.name, parameters: n.parameters, position: n.position };
    for (const k of ['onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData', 'executeOnce', 'notes', 'notesInFlow']) if (n[k] !== undefined) config[k] = n[k];
    const extras = [];
    if (!n.credentials && (n.type.includes('lmChatOpenRouter') || n.parameters.nodeCredentialType === 'openRouterApi')) n.credentials = {openRouterApi:{name:'OpenRouter account'}};
    if (n.credentials) extras.push('credentials:{' + Object.entries(n.credentials).map(([k, c]) => JSON.stringify(k) + ':newCredential(' + JSON.stringify(c.name) + ')').join(',') + '}');
    const models = Object.entries(w.connections).flatMap(([from, channels]) => Object.entries(channels).filter(([kind]) => kind !== 'main').flatMap(([kind, batches]) => batches.flat().filter(e => e.node === n.name).map(() => [kind, from])));
    if (models.length) extras.push('subnodes:{' + models.map(([kind, from]) => (kind === 'ai_languageModel' ? 'model' : 'outputParser') + ':' + index.get(from)).join(',') + '}');
    lines.push(`const ${index.get(n.name)}=${factory}({type:${JSON.stringify(n.type)},version:${n.typeVersion},config:{...${serialize(config)}${extras.length ? ',' + extras.join(',') : ''}},output:[{texto:"Texto exemplo",text:"Texto exemplo",cut:"Texto exemplo",baseText:"Texto exemplo",part:"Parte",angle:"Ângulo",sourceWordCount:300,decision:{accepted:false},error:null,operation:"generate",sourceKind:"recorte",decisionRequest:{}}]});`);
  }
  lines.push(`const w=workflow(${JSON.stringify(w.id ?? 'conteudos-modular')},${JSON.stringify(w.name)});`);
  for (const n of w.nodes.filter(n => !/lmChat|outputParser/.test(n.type))) lines.push(`w.add(${index.get(n.name)});`);
  for (const [from, c] of Object.entries(w.connections)) for (const [out, batch] of (c.main ?? []).entries()) for (const e of batch) lines.push(`w.add(${index.get(from)}.output(${out}).to(${index.get(e.node)}.input(${e.index})));`);
  lines.push('export default w;'); return lines.join('\n');
}
export async function buildModular({ simplify = true, atlasLayout = true, bragSegments = true } = {}) {
  const original = await read('modular-originais.json');
  const prep = structuredClone(original.prep), atlas = structuredClone(original.atlas), diary = structuredClone(original.diary), test = structuredClone(original.test);
  prep.name = 'Protótipo local — 01 Preparar KeyTopics e Recortes';
  addCode(prep, 'Preparar recortes compartilhados', validateDigest.toString() + '\n' + buildBlocks.toString() + "\nconst value=$input.first().json; return [{json:value.ok===false?value:{...value,blocks:buildBlocks(value)}}];", [1700, 300]);
  prep.connections['Validar e montar digestão'].main = [[{ node: 'Preparar recortes compartilhados', type: 'main', index: 0 }]];
  edge(prep, 'Preparar recortes compartilhados', 'Retornar digestão ao computador');
  atlas.name = 'Protótipo local — 02a Organizar Atlas de Conhecimento';
  prune(atlas, new Set(atlas.nodes.filter(n => /conteúdo|Conteúdo|Conteúdos/.test(n.name)).map(n => n.name)));
  edge(atlas, 'Montar nota preparada', 'Nota preparada válida?');
  atlas.nodes.find(n => n.name === 'Cortar texto deterministicamente').parameters.jsCode = "const input=$input.first().json;return input.blocks.map(block=>({json:{block,tree:input.categories,noteTree:input.notes,knowledgeThreshold:input.knowledgeThreshold},pairedItem:{item:0}}));";
  diary.name = 'Protótipo local — 02b Registrar Diário e Conquistas';
  const remove = new Set(diary.nodes.slice(38).map(n => n.name));
  for (const name of ['Comparar continuidade?', 'Preparar comparação de textos', 'Jev — Continuidade entre inputs', 'Validar decisão de continuidade', 'Retornar comparação', 'Reunir fluxo e conteúdo — Diário']) remove.add(name);
  prune(diary, remove);
  diary.connections['Pedido válido?'].main[0] = [{ node: 'Jev — Vitória', type: 'main', index: 0 }];
  edge(diary, 'Validar título e resumo', 'Preparar ações dos aspectos true');
  // Extract only the two editorial branches, keeping every reachable Agent parameter unchanged.
  const starts = ['Contar palavras para conteúdo — Diário1', 'Contar palavras para conteúdo — Diário'];
  const reachable = new Set(), queue = [...starts];
  while (queue.length) { const name = queue.shift(); if (reachable.has(name)) continue; reachable.add(name); for (const batch of test.connections[name]?.main ?? []) for (const e of batch) queue.push(e.node); }
  for (const [name, c] of Object.entries(test.connections)) if (Object.values(c).flat(2).some(e => reachable.has(e.node)) && !c.main) reachable.add(name);
  test.nodes = test.nodes.filter(n => reachable.has(n.name) || n.type.includes('stickyNote'));
  for (const name of Object.keys(test.connections)) if (!reachable.has(name)) delete test.connections[name];
  prune(test, new Set(['Transformar outputs em Markdown', 'pegar só essay e título']));
  test.name = 'Protótipo local — 03 Gerar Conteúdos para Redes'; test.id = 'segundo-cerebro-local-conteudos-v1';
  test.nodes.push(webhook('Receber pedido editorial'));
  addCode(test, 'Preparar texto de teste', `const input=$input.first().json.body??$input.first().json;
if(input.operation==='compare')return [{json:input}];
if(input.operation!=='generate'||!['recorte','grupo'].includes(input.sourceKind)||typeof input.source?.text!=='string'||!input.source.text.trim()||!input.source.id||!input.generationId||!input.generationBatchId)throw new Error('Pedido editorial inválido.');
const s=input.source;return [{json:{...input,text:s.text,texto:s.text,sourceId:s.sourceIds[0],sourceIds:s.sourceIds,groupId:s.id,threshold:input.threshold??0.8,knowledgeThreshold:input.threshold??0.8,...(input.sourceKind==='recorte'?{block:s}:{})}}];`, [-950, 0]);
  addIf(test, 'Comparar continuidade editorial?', '={{ $json.operation === "compare" }}', [-700, 0]);
  addIf(test, 'Gerar a partir de recorte?', '={{ $json.sourceKind === "recorte" }}', [-450, 0]);
  edge(test, 'Receber pedido editorial', 'Preparar texto de teste'); edge(test, 'Preparar texto de teste', 'Comparar continuidade editorial?'); edge(test, 'Comparar continuidade editorial?', 'Gerar a partir de recorte?', 1);
  edge(test, 'Gerar a partir de recorte?', starts[0]); edge(test, 'Gerar a partir de recorte?', starts[1], 1);
  for (const name of ['Validar pedido do Diário', 'Validar pedido do Atlas']) addCode(test, name, "return $input.all();", [-500, -300]);
  // Context aliases used by unchanged existing Codes. Connect them before routing.
  test.connections['Comparar continuidade editorial?'].main[1] = [{ node: 'Validar pedido do Diário', type: 'main', index: 0 }];
  edge(test, 'Validar pedido do Diário', 'Validar pedido do Atlas'); edge(test, 'Validar pedido do Atlas', 'Gerar a partir de recorte?');
  const social = original.diary;
  for (const name of ['Preparar comparação de textos', 'Jev — Continuidade entre inputs', 'Validar decisão de continuidade']) {
    const n = structuredClone(social.nodes.find(n => n.name === name));
    if (n.type.endsWith('.code')) n.parameters.jsCode = n.parameters.jsCode.replaceAll('Validar pedido do Diário', 'Preparar texto de teste');
    test.nodes.push(n);
  }
  test.nodes.push(response('Retornar comparação editorial'));
  edge(test, 'Comparar continuidade editorial?', 'Preparar comparação de textos'); edge(test, 'Preparar comparação de textos', 'Jev — Continuidade entre inputs'); edge(test, 'Jev — Continuidade entre inputs', 'Validar decisão de continuidade'); edge(test, 'Validar decisão de continuidade', 'Retornar comparação editorial');
  // Content generation intentionally does not require the Atlas knowledge gate.
  test.connections['Preparar julgamento de conhecimento rota1'].main = [[{ node: 'text-heavy', type: 'main', index: 0 }]];
  prune(test, new Set(['Jev — Tem conhecimento?', 'Validar decisão de conhecimento', 'Conhecimento aceito?']));
  // Preserve the test's deliberate empty full-text routes and emit an explicit terminal result.
  addCode(test, 'Grupo curto sem saída editorial', "return [{json:{reason:'O caminho de texto completo não possui saídas para até 200 palavras.'}}];", [500, 0]);
  const threadParts = test.nodes.find(n=>n.name==='Preparar partes da thread para Jev1');
  threadParts.parameters.jsCode = threadParts.parameters.jsCode.replace("parts=[$('Preparar primeiro bloco da thread1').first().json.firstPart,...socialParts(item.json.output)]", 'parts=socialParts(item.json.output)');
  for (const output of [0, 1]) edge(test, 'Rotear conteúdo por palavras — Diário', 'Grupo curto sem saída editorial', output);
  edge(test, 'Grupo curto sem saída editorial', 'Ver todos os outputs dos Agents');
  // Keep the existing diagnostics collector, but synchronize its inventory with this graph.
  const collector = test.nodes.find(n => n.name === 'Ver todos os outputs dos Agents');
  const terminals = ['Conservar decisão — imagem-post', 'Conservar decisão — imagem-post1', 'Conservar título e ensaio para conclusão', 'Conservar título e ensaio para conclusão1'];
  const originalAgentNames = test.nodes.filter(n => n.type.endsWith('.agent')).map(n => n.name);
  const checkpointNames = test.nodes.filter(n => n.type.endsWith('.agent') || n.type.endsWith('.httpRequest')).map(n => n.name);
  // Successful outputs can be replayed on a later attempt without calling a provider again.
  for (const name of checkpointNames) {
    const actual = test.nodes.find(n => n.name === name), actualName = name + ' — chamada';
    actual.name = actualName; actual.id = actualName;
    const gate = 'Retomar resultado — ' + name;
    const prepareGate = 'Conferir cache — ' + name;
    addCode(test, prepareGate, `const cache=$('Preparar texto de teste').first().json.cache?.[${JSON.stringify(name)}]?.[$runIndex];return $input.all().map((item,index)=>({json:{...item.json,_replayStage:Array.isArray(cache)},pairedItem:{item:index}}));`, [actual.position[0]-500,actual.position[1]]);
    const savedExpr = '={{ $json._replayStage === true }}';
    addIf(test, gate, savedExpr, [actual.position[0] - 260, actual.position[1]]);
    // Redirect inbound main connections to the gate; keep the original output node name.
    for (const channels of Object.values(test.connections)) for (const [kind, batches] of Object.entries(channels)) for (const batch of batches) for (const e of batch) if (e.node === name) e.node = kind === 'main' ? prepareGate : actualName;
    edge(test, prepareGate, gate);
    test.connections[actualName] = { main: [[{ node: name, type: 'main', index: 0 }]] };
    edge(test, gate, name); edge(test, gate, actualName, 1);
    addCode(test, name, `const cache=$('Preparar texto de teste').first().json.cache?.[${JSON.stringify(name)}]?.[$runIndex];\nif(Array.isArray(cache))return cache.map((json,item)=>({json,pairedItem:{item:Math.min(item,$input.all().length-1)}}));\nreturn $input.all();`, [actual.position[0] + 260, actual.position[1]]);
  }
  const graph = Object.entries(test.connections).flatMap(([source, c]) => (c.main ?? []).flatMap((batch, output) => batch.map(e => ({ source, target: e.node, output })))).filter(e => !['Ver todos os outputs dos Agents', 'Retornar comparação editorial'].includes(e.target));
  const names = test.nodes.filter(n => !n.type.includes('sticky') && !/lmChat/.test(n.type) && !['Ver todos os outputs dos Agents', 'Retornar comparação editorial', 'Preparar comparação de textos', 'Jev — Continuidade entre inputs', 'Validar decisão de continuidade', 'Jev — Continuidade entre inputs — chamada', 'Retomar resultado — Jev — Continuidade entre inputs'].includes(n.name)).map(n => n.name);
  collector.parameters.jsCode = collector.parameters.jsCode.replace(/const graph=\[.*?\](?:,names=\[.*?\])?;/, 'const graph=' + JSON.stringify(graph) + ';\nconst names=' + JSON.stringify(names) + ';').replace(/const names=\[.*?\];/g, 'const names=' + JSON.stringify(names) + ';')
    .replace(/const agentNames=\[.*?\],jevNames=/, 'const agentNames=' + JSON.stringify(originalAgentNames) + ',jevNames=');
  collector.parameters.jsCode = collector.parameters.jsCode.replace('const stages=Array.isArray(value.stageErrors)?value.stageErrors:[];', "if(value.error)errosBrutos.push({node,erro:value.error});if(value.decision?.error)errosBrutos.push({node,erro:{message:value.decision.error}});const stages=Array.isArray(value.stageErrors)?value.stageErrors:[];");
  const marker = 'const resultadosFinais=[';
  const start = collector.parameters.jsCode.indexOf(marker) + marker.length;
  collector.parameters.jsCode = collector.parameters.jsCode.slice(0, start) + terminals.map(JSON.stringify).join(',') + ',' + collector.parameters.jsCode.slice(start);
  collector.parameters.jsCode += `\n`;
  // A single final Code creates publication documents and stage checkpoints.
  addCode(test, 'Organizar posts e checkpoints', normalizeEditorial.toString() + '\n' + validEditorialCheckpoint.toString() + `\nconst result=$input.first().json;const normalized=normalizeEditorial(result);const cache={};
for(const name of ${JSON.stringify(checkpointNames)}){if(!$(name).isExecuted)continue;cache[name]=[];for(let run=0;run<256;run++){try{const values=$(name).all(0,run).map(i=>i.json);cache[name][run]=validEditorialCheckpoint(name,values)&&!normalized.errors.some(e=>e.node===name)?values:null;}catch{break;}}}
for(const name of Object.keys(cache))cache[name]=Object.fromEntries(cache[name].flatMap((v,i)=>v?[[i,v]]:[]));
return [{json:{ok:true,...normalized,cache,workflowId:$workflow.id,executionId:$execution.id,diagnostics:result}}];`, [4100, 0]);
  test.nodes.push(response('Retornar posts ao computador')); edge(test, 'Ver todos os outputs dos Agents', 'Organizar posts e checkpoints'); edge(test, 'Organizar posts e checkpoints', 'Retornar posts ao computador');
  // Add the direct results to the collector, allowing it to emit after their downstream work ends.
  for (const name of terminals) edge(test, name, 'Ver todos os outputs dos Agents');
  for (const w of [prep, atlas, diary, test]) { delete w.activeVersion; delete w.activeVersionId; delete w.pinData; w.active = false; }
  const layout = await read('editorial-layout.json');
  for (const n of test.nodes) {
    if (layout.positions[n.name]) n.position = layout.positions[n.name];
    if (layout.notes[n.name]) {
      const {position,width,height} = layout.notes[n.name];
      n.position = position; n.parameters.width = width; n.parameters.height = height;
    }
  }
  const organizedDiary=diaryWithoutLoop(diary);
  return { prep, atlas: fixAtlasTitle(atlasLayout ? organizeAtlas(atlas) : atlas), diary: bragSegments ? bragBySegments(organizedDiary) : organizedDiary, generation: fixImageJevBodies(simplify ? simplifyEditorial(test) : test) };
}
export async function writeModular() {
  const all = await buildModular();
  for (const [key, w] of Object.entries(all)) {
    const prefix = { prep: '01-digestao', atlas: '02a-atlas', diary: '02b-diario-registros', generation: '03-editorial' }[key];
    await writeFile(new URL(prefix + '.importar.json', import.meta.url), JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings: { executionOrder: 'v1', availableInMCP: true } }, null, 2));
    await writeFile(new URL(prefix + '.nodes.json', import.meta.url), JSON.stringify(w.nodes, null, 2));
    await writeFile(new URL(prefix + '.sdk.js', import.meta.url), sdkCode(w));
  }
  return all;
}
