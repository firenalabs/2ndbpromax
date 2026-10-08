import { readFile, writeFile } from 'node:fs/promises';
import * as social from '../posts-sociais.mjs';

const legacy = JSON.parse(await readFile(new URL('./02b-diario.legacy.json', import.meta.url), 'utf8'));
const source = JSON.parse(await readFile(new URL('./para-incorporar.origem.json', import.meta.url), 'utf8'));
const first = 'Contar palavras para conteúdo — Diário1';
const last = 'Reunir todos os tweets — Diário';
const remove = new Set([first]), queue = [first];
while (queue.length) {
  const name = queue.shift();
  if (name === last) continue;
  for (const batch of legacy.connections[name]?.main ?? []) for (const edge of batch) {
    if (!remove.has(edge.node)) { remove.add(edge.node); queue.push(edge.node); }
  }
}
const nodes = legacy.nodes.filter(n => !remove.has(n.name)).map(n => structuredClone(n));
const connections = {};
for (const [name, channels] of Object.entries(legacy.connections)) {
  if (remove.has(name)) continue;
  connections[name] = {};
  for (const [channel, batches] of Object.entries(channels)) connections[name][channel] = batches.map(batch => batch.filter(e => !remove.has(e.node)));
}
for (const n of source.nodes) {
  if (nodes.some(old => old.name === n.name)) throw new Error('Nome duplicado: ' + n.name);
  nodes.push(structuredClone(n));
}
for (const [name, channels] of Object.entries(source.connections)) connections[name] = structuredClone(channels);
const get = name => nodes.find(n => n.name === name);
const edge = (from, to, output = 0, input = 0, type = 'main') => {
  connections[from] ??= {};
  connections[from][type] ??= [];
  while (connections[from][type].length <= output) connections[from][type].push([]);
  if (!connections[from][type][output].some(e => e.node === to && e.index === input)) connections[from][type][output].push({ node: to, type, index: input });
};
const disconnect = (from, to) => {
  for (const batch of connections[from]?.main ?? []) {
    for (let i = batch.length - 1; i >= 0; i--) if (batch[i].node === to) batch.splice(i, 1);
  }
};
const addCode = (name, jsCode, position) => {
  const n = { name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode } };
  nodes.push(n); return name;
};
const helpers = Object.entries(social).filter(([, v]) => typeof v === 'function').map(([, v]) => v.toString()).join('\n') + "\nconst socialNetworks=['Twitter','LinkedIn','Instagram'];\n";
const base = `const base=$('${first}').first().json;\n`;
const wrap = body => helpers + '\n' + base + body;
const contextBefore = predecessor => `const context=$('${predecessor}').itemMatching(index).json;`;
const addIf = (name, expression, rightValue, operation, position) => {
  nodes.push({ name, type: 'n8n-nodes-base.if', typeVersion: 2.3, position, parameters: {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: expression, rightValue, operator: { type: typeof rightValue === 'number' ? 'number' : 'boolean', operation } }], combinator: 'and' }, options: {} } });
  return name;
};
const normalizeNodes = [];
const collector = 'Reunir todos os posts — Diário';
const normalize = (name, family, predecessor, body = '') => {
  const code = wrap(`const items=$input.all();\nconst contexts=items.map((item,index)=>{ ${predecessor ? contextBefore(predecessor) : 'const context=base;'} ${body} return context; });\nreturn [{json:normalizeSocialBatch(items.map(i=>i.json),${JSON.stringify(family)},contexts),pairedItem:items.map((_,item)=>({item}))}];`);
  addCode(name, code, [2400, 300 + normalizeNodes.length * 240]);
  normalizeNodes.push(name); edge(name, collector); return name;
};

const webhook = get('Receber pedido do Diário');
webhook.parameters.path = 'segundo-cerebro-local-diario-social-v2';
delete webhook.webhookId;
get(first).parameters.jsCode = "const context=$input.first().json;\nconst text=context.text;\nreturn [{json:{text,texto:text,'transcrição original':text,system_prompt:'',referenceId:context.groupId,contentTitle:'Conteúdo do Diário',contentSourceIds:context.sourceIds,sourceWordCount:(text.match(/\\S+/g)??[]).length}}];";
edge('Respostas Jev válidas?', first);
edge(collector, 'Reunir fluxo e conteúdo — Diário', 0, 1);

const appendReturn = (name, instruction) => {
  const agent = get(name);
  agent.parameters.options.systemMessage += '\n\n## Contrato de retorno para integração\n' + instruction + '\nRetorne JSON válido, sem cercas de código ou comentários fora do JSON. Preserve todas as regras de conteúdo, tom e quantidade acima; esta instrução muda somente a representação do retorno.';
};
for (const name of ['Tweets/Stories sem angulo', 'Tweets/Stories com angulo', 'Interação com seguidores', 'Interação com seguidores (até 3)', 'text-heavy', 'text-heavy com angulo']) {
  appendReturn(name, 'Retorne {"posts":[{"text":"texto completo do post"}]}. Um objeto por post autônomo; quebras de linha devem estar dentro de text. Não divida um post em vários objetos.');
}
for (const name of ['Sequência de pensamentos rápidos', 'thread', 'carrossel - linguagem flesch 8-9 ano', 'carrossel - linguagem flesch 8-9 ano1', 'carrossel - linguagem flesch 8-9 ano2', 'carrossel - linguagem flesch 8-9 ano3']) {
  appendReturn(name, 'Retorne {"parts":["texto da primeira parte produzida","texto da próxima parte produzida"]}. As partes constituem UM conteúdo, na ordem original. Não transforme as partes em posts independentes. Não reproduza o primeiro bloco/slide dado no input quando as instruções acima mandarem começar pelo segundo.');
}
for (const name of ['Legenda completa instagram', 'ensaio com angulo', 'ensaio sem angulo', 'SOFT CTA PARA O PROPRIO TEXTO']) appendReturn(name, 'Retorne {"text":"todo o texto solicitado, com suas quebras de linha"}.');
appendReturn('título e subtítulo', 'Retorne {"title":"headline vencedora","subtitle":"subtítulo, se houver","analysis":"todos os candidatos, tabela de notas e justificativa solicitados acima em texto/Markdown"}.');

const router = 'Rotear conteúdo por palavras — Diário1';
const originalRoutes = structuredClone(source.connections[router].main);
const routeNames = [];
const familyFor = name => name.startsWith('Angulos para até') && name.endsWith('tweets') || name === 'Tweets/Stories sem angulo' ? 'quick'
  : name.startsWith('Interação') ? 'interaction' : name === 'Sequência de pensamentos rápidos' ? 'sequence'
    : name === 'thread' ? 'thread' : name.startsWith('Jev — tutorial') ? 'carousel'
      : name.includes('posts M') || name === 'text-heavy' || name === 'Angulos x posts 3200+' ? 'heavy' : 'essay';
connections[router].main = [];
for (let i = 0; i < originalRoutes.length; i++) {
  const families = [...new Set(originalRoutes[i].map(e => familyFor(e.node)))];
  const name = addCode(`Preparar rota social ${i + 1}`, `return $input.all().map((item,index)=>({json:{...item.json,expectedFamilies:${JSON.stringify(families)}},pairedItem:{item:index}}));`, [-480, 2240 + i * 100]);
  routeNames.push(name); edge(router, name, i);
  for (const e of originalRoutes[i]) edge(name, e.node);
}
const fallback = addCode('Sem rota social — conservar resposta', "return [{json:{generatedContents:[],generatedContentErrors:[{origin:'diario',message:'Quantidade de palavras sem rota social.'}],completedKeys:['fallback']}}];", [-128, 2880]);
edge(router, fallback, originalRoutes.length); edge(fallback, collector); normalizeNodes.push(fallback);

const quick = normalize('Organizar pensamentos rápidos por rede', 'quick', 'Edit Fields');
const quickDirect = normalize('Organizar pensamento direto por rede', 'quick', null);
edge('Tweets/Stories sem angulo', quickDirect); edge('Tweets/Stories com angulo', quick);
edge('Falha ao gerar ângulos?', quick, 0);
const interaction = normalize('Organizar interações por rede', 'interaction', null);
edge('Interação com seguidores', interaction); edge('Interação com seguidores (até 3)', interaction);
const sequence = normalize('Organizar sequência como um post por rede', 'sequence', null);
edge('Sequência de pensamentos rápidos', sequence);

const splitAngles = (name, prefix = '') => {
  get(name).parameters.jsCode = wrap(`return $input.all().flatMap((item,index)=>{\nlet angles;\ntry { if(item.json.error)throw new Error(item.json.error.message??item.json.error); const output=parseSocialOutput(item.json.output); angles=Array.isArray(output)?output:output?.angles??output?.angulos??(typeof output==='string'?output.split(/^\\s*---+\\s*$/m).filter(s=>s.trim()):[]); if(!angles.length||angles.some(a=>typeof a!=='string'||!a.trim()))throw new Error('Ângulos vazios ou inválidos.'); }catch(error){return [{json:{...base,error:{message:error.message},tweetIndex:1,contentIndex:1},pairedItem:{item:index}}];}\nreturn angles.map((angle,part)=>({json:{...base,angle:angle.trim(),tweetIndex:part+1,contentIndex:part+1,texto:base.text+'\\n\\nÂngulo deste item: '+angle.trim(),error:null},pairedItem:{item:index}}));\n});`);
};
splitAngles('Edit Fields'); splitAngles('Edit Fields1');

const threadInput = addCode('Preparar primeiro bloco da thread', "return $input.all().map((item,index)=>{const firstPart=item.json.text.split(/(?<=[.!?])\\s+|\\n\\s*\\n/)[0].trim();return {json:{...item.json,firstPart,texto:'<texto-base>\\n'+item.json.text+'\\n</texto-base>\\n<primeiro-bloco>\\n'+firstPart+'\\n</primeiro-bloco>'},pairedItem:{item:index}};});", [240,3152]);
for(const route of routeNames){disconnect(route,'thread');if(originalRoutes[routeNames.indexOf(route)].some(e=>e.node==='thread'))edge(route,threadInput);}
edge(threadInput,'thread');
const threadPrepare = addCode('Preparar partes da thread para Jev', wrap(`return $input.all().flatMap((item,index)=>{let parts=[],error=item.json.error;try{if(!error)parts=[$('Preparar primeiro bloco da thread').first().json.firstPart,...socialParts(item.json.output)];}catch(e){error={message:e.message};}return (parts.length?parts:['']).map((part,partIndex)=>({json:{...base,firstPart:$('Preparar primeiro bloco da thread').first().json.firstPart,parts,part,partIndex,output:item.json.output,error},pairedItem:{item:index}}));});`), [496, 3280]);
disconnect('thread', 'Jev — CABE google imagens? (para cada tweet)'); edge('thread', threadPrepare); edge(threadPrepare, 'Jev — CABE google imagens? (para cada tweet)');

const jevDefinitions = [
  ['Jev — tutorial/how-to carrossel', 'tutorial', 'carousel-tutorial', 'O texto contém um método ou processo que pode ser organizado em um tutorial passo a passo?', 'Passos ou método aplicável explicitamente descritos.', 'Não há passos ou método explícitos; seria necessário inventá-los.'],
  ['Jev — Storytelling carrossel', 'storytelling', 'carousel-storytelling', 'O texto relata uma história com sequência de acontecimentos que pode virar um carrossel de storytelling?', 'Há acontecimentos e progressão narrativa explícitos.', 'Não há história ou sequência factual no texto.'],
  ['Jev — Checklist carrossel', 'checklist', 'carousel-checklist', 'O texto fornece critérios ou verificações que podem ser organizados como checklist?', 'Há verificações, cuidados ou critérios acionáveis explícitos.', 'Não há critérios verificáveis; uma checklist exigiria conteúdo inventado.'],
  ['Jev — Lista carrossel1', 'lista', 'carousel-lista', 'O texto contém vários pontos que podem ser apresentados como lista de um carrossel?', 'Há pontos distintos, explícitos e relacionados à mesma ideia.', 'O conteúdo não apresenta vários pontos distintos.'],
  ['Jev — CABE google imagens? (para cada tweet)', 'imagem', null, 'Uma imagem encontrada em pesquisa pode ilustrar este bloco do conteúdo sem inventar evidências?', 'O bloco menciona um objeto, lugar, processo ou conceito visual identificável; a imagem pode ser ilustrativa.', 'Uma imagem genérica não acrescentaria clareza ou poderia simular prova, resultado ou pessoa não identificada.'],
  ['Jev — CABE google imagens? (para cada tweet)1', 'imagem', null, 'Uma imagem encontrada em pesquisa pode ilustrar este post sem inventar evidências?', 'Há assunto visual identificável e a imagem pode esclarecer o conteúdo como ilustração.', 'Uma imagem genérica não acrescentaria clareza ou poderia simular prova, resultado ou pessoa não identificada.'],
];
const carouselStyles = { tutorial: 'Organize como passos do método explicitado no texto-base.', storytelling: 'Organize na sequência dos acontecimentos explicitados no texto-base.', checklist: 'Organize como verificações ou critérios explicitados no texto-base.', lista: 'Organize os pontos distintos explicitados no texto-base.' };
const decisions = [];
for (const [name, key, variant, question, yes, no] of jevDefinitions) {
  const n = get(name);
  n.parameters.jsonBody = '={{ { ' + JSON.stringify({model:'typesafe/jev-1.13'}).slice(1,-1) + ", state: {text: $json.part ?? $json.baseText ?? $json.text ?? $json.texto}, questions: {" + JSON.stringify(key) + ': ' + JSON.stringify({type:'noul',instructions:question,criteria:{true:yes,false:no}}) + '} } }}';
  const savedEdges = structuredClone(connections[name]?.main?.[0] ?? []);
  connections[name] = { main: [[]] };
  const before = variant ? null : key === 'imagem' && name.endsWith('1') ? 'Preparar text-heavy para decisões' : threadPrepare;
  const restore = addCode(`Conservar decisão — ${variant ?? (name.endsWith('1') ? 'imagem-post' : 'imagem-thread')}`, wrap(`return $input.all().map((item,index)=>{${before ? contextBefore(before) : 'const context=base;'}\nconst answer=item.json.answers?.[${JSON.stringify(key)}];const threshold=$('Validar pedido do Diário').first().json.threshold;\nconst valid=answer?.type==='noul'&&Number.isFinite(answer.noul)&&answer.noul>=0&&answer.noul<=1;\nconst decision={key:${JSON.stringify(key)},node:${JSON.stringify(name)},probability:valid?answer.noul:null,threshold,accepted:valid&&answer.noul>=threshold,error:valid?null:String(item.json.error?.message??item.json.error??'Probabilidade Jev inválida'),model:'typesafe/jev-1.13'};\nreturn {json:{...context,decision,imageDecision:${variant ? 'context.imageDecision??null' : 'decision'},${variant ? `carouselVariant:${JSON.stringify(variant)},system_prompt:${JSON.stringify(carouselStyles[key])},` : ''}output:context.output},pairedItem:{item:index}};});`), [get(name).position[0], get(name).position[1] + 140]);
  decisions.push(restore); edge(name, restore);
  if (variant) {
    const writer = savedEdges.find(e => e.node.startsWith('carrossel'))?.node;
    for (const e of savedEdges.filter(e => !e.node.startsWith('carrossel'))) edge(restore, e.node);
    const gate = addIf(`Formato ${key} aceito?`, '={{ $json.decision.accepted }}', true, 'equals', [get(name).position[0], get(name).position[1] + 280]);
    edge(restore, gate); edge(gate, writer);
    const prep = addCode(`Preparar input carrossel — ${key}`, `return $input.all().map((item,index)=>({json:{...item.json,texto:'<texto-base>\\n'+item.json.text+'\\n</texto-base>\\n<primeiro-slide>\\n'+item.json.text.split(/(?<=[.!?])\\s+|\\n\\s*\\n/)[0].trim()+'\\n</primeiro-slide>',firstPart:item.json.text.split(/(?<=[.!?])\\s+|\\n\\s*\\n/)[0].trim()},pairedItem:{item:index}}));`, [get(writer).position[0], get(writer).position[1] - 96]);
    disconnect(gate, writer); edge(gate, prep); edge(prep, writer);
    const captionPrep = addCode(`Preservar slides — ${key}`, wrap(`return $input.all().map((item,index)=>{${contextBefore(prep)} return {json:{...context,partsOutput:item.json.output,error:item.json.error,texto:base.text+'\\n\\nSlides do conteúdo:\\n'+JSON.stringify(item.json.output)},pairedItem:{item:index}};});`), [get(writer).position[0], get(writer).position[1] + 180]);
    disconnect(writer, 'Legenda completa instagram'); edge(writer, captionPrep);
    edge(captionPrep, 'Preparar legenda com slides');
    const skip = addCode(`Carrossel ${key} não selecionado`, `return $input.all().map((item,index)=>({json:{generatedContents:[],generatedContentErrors:item.json.decision.error?[{origin:'diario',stage:${JSON.stringify(name)},message:item.json.decision.error}]:[],completedKeys:[${JSON.stringify(variant)}]},pairedItem:{item:index}}));`, [get(name).position[0], get(name).position[1] + 420]);
    edge(gate, skip, 1); edge(skip, collector); normalizeNodes.push(skip);
  }
}

const threadRestore = decisions.find(n => n.endsWith('imagem-thread'));
const threadNormalize = addCode('Organizar thread completa por rede', wrap(`const items=$input.all();const context=items[0].json;\ncontext.imageDecision=items.map(i=>({partIndex:i.json.partIndex,...i.json.imageDecision}));\nconst value={output:context.output,error:context.error};\nreturn [{json:normalizeSocialBatch([value],'thread',[context]),pairedItem:items.map((_,item)=>({item}))}];`), [1040, 3312]);
edge(threadRestore, threadNormalize); edge(threadNormalize, collector); normalizeNodes.push(threadNormalize);

const commonCaption = addCode('Preparar legenda com slides', 'return $input.all().map((item,index)=>({json:item.json,pairedItem:{item:index}}));', [1440, 4336]);
edge(commonCaption, 'Legenda completa instagram');
const captionRestore = addCode('Reunir carrossel e legenda', wrap(`return $input.all().map((item,index)=>{${contextBefore(commonCaption)}\nconst caption=socialText(parseSocialOutput(item.json.output));\nconst stageErrors=item.json.error?[socialError(item.json.error,context,'Legenda completa instagram')]:[];\nreturn {json:{...context,caption,stageErrors,output:context.partsOutput},pairedItem:{item:index}};});`), [1936, 4336]);
edge('Legenda completa instagram', captionRestore);
const carouselNormalize = normalize('Organizar carrossel completo por rede', 'carousel', captionRestore);
edge(captionRestore, carouselNormalize);

const heavyPrep = addCode('Preparar text-heavy para decisões', wrap(`return $input.all().flatMap((item,index)=>{\nlet context=base;if($('Edit Fields1').isExecuted)context=$('Edit Fields1').itemMatching(index).json;\nlet posts=[],error=item.json.error;try{if(!error)posts=socialPosts(item.json.output);}catch(e){error={message:e.message};}\nreturn (posts.length?posts:['']).map((text,j)=>({json:{...context,contentIndex:context.contentIndex??j+1,baseText:text,texto:text,output:{text},error},pairedItem:{item:index}}));});`), [1792, 5616]);
disconnect('text-heavy', 'Jev — CABE google imagens? (para cada tweet)1');
edge('text-heavy', heavyPrep); edge('text-heavy com angulo', heavyPrep);
edge(heavyPrep, 'Jev — CABE google imagens? (para cada tweet)1');
const heavyRestore = decisions.find(n => n.endsWith('imagem-post'));
const twitterNorm = normalize('Organizar text-heavy Twitter', 'heavy-twitter', heavyRestore);
edge(heavyRestore, twitterNorm);
const failedHeavy = addCode('Conservar falha de ângulos text-heavy', 'return $input.all().map((item,index)=>({json:{...item.json,contentIndex:1,output:{text:""}},pairedItem:{item:index}}));', [1376, 5776]);
edge('Falha ao gerar ângulos?1', failedHeavy, 0); edge(failedHeavy, heavyPrep);
for (const [network, limit, family] of [['LinkedIn',3000,'heavy-linkedin'],['Instagram',2200,'heavy-instagram']]) {
  const gate = addIf(`Text-heavy excede ${limit} caracteres — ${network}?`, '={{ $json.error ? 0 : $json.baseText.length }}', limit, 'gt', [1936, network==='LinkedIn'?5776:5936]);
  edge(heavyRestore, gate);
  const adapter = `Adaptar text-heavy — ${network}`;
  nodes.push({name:adapter,type:'@n8n/n8n-nodes-langchain.agent',typeVersion:3.1,position:[2144,network==='LinkedIn'?5776:6096],onError:'continueRegularOutput',parameters:{promptType:'define',text:'={{ $json.baseText }}',options:{systemMessage:`Adapte o texto recebido para ${network} com no máximo ${limit} caracteres, contando espaços e quebras de linha. Preserve os fatos, a primeira pessoa, o vocabulário e o tom do autor. Reduza repetições sem inventar conteúdo. Retorne somente JSON válido {"text":"texto adaptado"}.`}}});
  edge('OpenRouter Chat Model5',adapter,0,0,'ai_languageModel'); edge(gate,adapter);
  const keep = addCode(`Conservar texto — ${network}`, 'return $input.all().map((item,index)=>({json:{...item.json,output:{text:item.json.baseText}},pairedItem:{item:index}}));',[2144,network==='LinkedIn'?5936:6256]);
  edge(gate,keep,1);
  const norm = normalize(`Organizar text-heavy ${network}`,family,heavyRestore);
  edge(adapter,norm); edge(keep,norm);
}

const essaySplit = addCode('Separar ângulos de ensaios', get('Edit Fields1').parameters.jsCode, [496, 6992]);
disconnect('Angulos para long-form 3200+', 'ensaio com angulo'); edge('Angulos para long-form 3200+',essaySplit); edge(essaySplit,'ensaio com angulo');
const essayPrep = addCode('Conservar ensaio para título', wrap(`return $input.all().map((item,index)=>{let context=base;if($('${essaySplit}').isExecuted)context=$('${essaySplit}').itemMatching(index).json;\nconst essayBody=socialText(parseSocialOutput(item.json.output));\nreturn {json:{...context,essayBody,texto:essayBody,cut:essayBody,stageErrors:item.json.error?[socialError(item.json.error,context,'ensaio')]:[],error:item.json.error},pairedItem:{item:index}};});`), [896, 6800]);
for (const n of ['ensaio sem angulo','ensaio com angulo']) {disconnect(n,'título e subtítulo');edge(n,essayPrep);}
edge(essayPrep,'título e subtítulo');
const headlinePrep = addCode('Conservar título e ensaio para conclusão', wrap(`return $input.all().map((item,index)=>{${contextBefore(essayPrep)}\nconst headline=parseSocialOutput(item.json.output);const stageErrors=[...(context.stageErrors??[])];if(item.json.error)stageErrors.push(socialError(item.json.error,context,'título e subtítulo'));\nreturn {json:{...context,headline,stageErrors,cut:context.essayBody,texto:context.essayBody},pairedItem:{item:index}};});`), [1200, 6800]);
disconnect('título e subtítulo','SOFT CTA PARA O PROPRIO TEXTO');edge('título e subtítulo',headlinePrep);edge(headlinePrep,'SOFT CTA PARA O PROPRIO TEXTO');
const essayNorm = normalize('Organizar ensaio completo por rede','essay',headlinePrep);
edge('SOFT CTA PARA O PROPRIO TEXTO',essayNorm);

const collectCode = wrap(`function readRuns(name){if(!$(name).isExecuted)return [];const all=[];for(let run=0;run<256;run++){try{const items=$(name).all(0,run);all.push(...items.map(i=>i.json));}catch{break;}}return all;}\nconst batches=${JSON.stringify(normalizeNodes)}.flatMap(readRuns);\nconst route=${JSON.stringify(routeNames)}.find(name=>$(name).isExecuted);\nif(!route){const result=collectSocialResults(batches,['fallback']);return result?[{json:result}]:[];}\nconst families=$(route).first().json.expectedFamilies;const expected=[];\nfor(const family of families){\n if(family==='quick'){const count=$('Edit Fields').isExecuted?$('Edit Fields').all().length:1;for(let i=1;i<=count;i++)expected.push('quick-'+i);}\n else if(family==='heavy'){if(!$('${heavyPrep}').isExecuted)return [];for(const item of $('${heavyPrep}').all()){for(const network of ['twitter','linkedin','instagram'])expected.push('heavy-'+network+'-'+item.json.contentIndex);}}\n else if(family==='essay'){const count=$('${essaySplit}').isExecuted?$('${essaySplit}').all().length:1;for(let i=1;i<=count;i++)expected.push('essay-'+i);}\n else if(family==='carousel')expected.push('carousel-tutorial','carousel-storytelling','carousel-checklist','carousel-lista');\n else expected.push(family);\n}\nconst result=collectSocialResults(batches,expected);if(!result)return [];\nconst decisions=${JSON.stringify(decisions)}.flatMap(name=>readRuns(name).map(item=>({partIndex:item.partIndex??null,contentIndex:item.contentIndex??null,...item.decision})));\nresult.contentDecisions=decisions;result.generatedContents=result.generatedContents.map(content=>({...content,jevDecisions:decisions}));\nreturn [{json:result}];`);
addCode(collector, collectCode, [2848, 2336]);
get('Montar Diário e Conquistas completos').parameters.jsCode = get('Montar Diário e Conquistas completos').parameters.jsCode.replace('generatedContents:first.generatedContents??[],', 'contentDecisions:first.contentDecisions??[], generatedContents:first.generatedContents??[],');
const guide={name:'Guia — Retorno social e preservação legacy',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[-848,7600],parameters:{content:'## Posts por rede social\nCada pensamento/interação independente vira um documento por rede. Partes de sequências, threads e carrosséis ficam no mesmo arquivo com ---; LinkedIn agrupa sequências num texto.\n\nText-heavy: LinkedIn até 3000 caracteres, Instagram até 2200; somente textos acima dos limites chamam os Agents de adaptação. Ensaios: Twitter/LinkedIn Artigos, incluindo título e conclusão.\n\nJevs avaliam formatos e pertinência de imagens. As decisões são metadados; este fluxo não busca nem gera imagens/PDFs. Prompts originais recebem apenas instruções de retorno JSON.\n\nO programa salva em Conteúdos Gerados/LinkedIn, Twitter e Instagram. O workflow original Psg7X7QwGWoVTnLO e seu webhook permanecem intactos. O novo webhook é segundo-cerebro-local-diario-social-v2.',width:1800,height:500,color:6}};
nodes.push(guide);
for (const node of nodes) {
  // Keep source nodes and their sticky notes together, below the preserved diary.
  if (!legacy.nodes.some(old => old.name === node.name) || remove.has(node.name)) node.position = [node.position[0], node.position[1] + 4800];
  delete node.id;
  if (node.type.includes('lmChatOpenRouter') || node.parameters?.nodeCredentialType==='openRouterApi') node.credentials={openRouterApi:{id:'nhHZnO3IKAN56m8N',name:'OpenRouter account'}};
}
const names=new Set(nodes.map(n=>n.name));
if(names.size!==nodes.length)throw new Error('Nomes duplicados.');
for(const [name,channels]of Object.entries(connections))for(const batches of Object.values(channels))for(const batch of batches)for(const e of batch){if(!names.has(name)||!names.has(e.node))throw new Error('Conexão pendente: '+name+' → '+e.node);}
const plan={name:'Protótipo local — 02b Diário e Conquistas — Posts por Rede (v2)',nodes,connections,normalizeNodes,routeNames,remove:[...remove]};
await writeFile(new URL('./02b-diario-social.importar.json',import.meta.url),JSON.stringify({name:plan.name,nodes,connections,settings:{executionOrder:'v1',availableInMCP:true}},null,2)+'\n');
console.log(JSON.stringify({nodes:nodes.length,normalizers:normalizeNodes.length,legacyNodesRemoved:remove.size,webhook:webhook.parameters.path}));
