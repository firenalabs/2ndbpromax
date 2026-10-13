// Mantém as chamadas existentes e os pontos de extensão dos seis aspectos.
export function diaryWithoutLoop(workflow) {
  const w = structuredClone(workflow);
  const loop = 'Executar cada aspecto true';
  if (!w.nodes.some(n => n.name === loop)) return w;
  const find = name => {
    const n = w.nodes.find(n => n.name === name);
    if (!n) throw new Error('Node esperado ausente: ' + name);
    return n;
  };
  const mergeName = 'Aguardar as seis avaliações Jev';
  const jevs = ['Vitória', 'Obstáculo', 'História', 'Gratidão', 'Piada', 'Vida pessoal'].map(label => 'Jev — ' + label);
  const to = (name, index = 0) => ({node:name, type:'main', index});
  w.nodes = w.nodes.filter(n => n.name !== loop);
  delete w.connections[loop];
  w.nodes.push({name:mergeName, id:mergeName, type:'n8n-nodes-base.merge', typeVersion:3.2,
    parameters:{mode:'append', numberInputs:6}, position:[3104,2616]});
  w.connections['Pedido válido?'].main[0] = jevs.map(name => to(name));
  jevs.forEach((name, i) => { w.connections[name].main = [[to(mergeName, i)]]; });
  w.connections[mergeName] = {main:[[to('Reunir aspectos e definir rotas')]]};
  w.connections['Preparar ações dos aspectos true'].main = [[to('Rotear aspectos true')]];
  w.connections['Registrar resultado da ação'].main = [[to('Montar Diário e Conquistas completos')]];
  const prepare = find('Preparar ações dos aspectos true');
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace('map(json=>({json}))', 'map(json=>({json,pairedItem:{item:0}}))');
  find('Registrar resultado da ação').parameters.jsCode = `return $input.all().map((item, index) => {
  const context = $('Preparar ações dos aspectos true').itemMatching(index).json;
  const result = item.json;
  return {json:{...context,...result,aspect:context.aspect,errors:{...context.errors,...result.errors}},pairedItem:{item:index}};
});`;
  const final = find('Montar Diário e Conquistas completos');
  const oldTail = 'return [{json:combineFinalization($input.all().map(item=>item.json))}];';
  if (!final.parameters.jsCode.includes(oldTail)) throw new Error('Montagem final mudou; revisar antes de remover o loop.');
  final.parameters.jsCode = final.parameters.jsCode.replace(oldTail, `// Cada caminho registra seu resultado. Só o último a concluir emite o retorno.
const context = $('Validar título e resumo').first().json;
const active = Object.keys(context.aspects.flags).filter(key => context.aspects.flags[key]);
const expected = active.length ? active : ['none'];
const completed = new Map();
let lastAspect;
for (let run = 0; run < expected.length; run++) {
  let items;
  try { items = $('Registrar resultado da ação').all(0, run); } catch { break; }
  for (const item of items) {
    if (expected.includes(item.json.aspect)) {
      completed.set(item.json.aspect, item.json);
      lastAspect = item.json.aspect;
    }
  }
}
if (expected.some(aspect => !completed.has(aspect))) return [];
// Evita resposta duplicada mesmo se o n8n enfileirar a montagem dos ramos juntos.
if (!$input.all().some(item => item.json.aspect === lastAspect)) return [];
return [{json:combineFinalization(expected.map(aspect => completed.get(aspect)))}];`);
  const positions = {
    'Receber pedido do Diário':[1760,2616], 'Validar pedido do Diário':[2000,2616], 'Pedido válido?':[2240,2616],
    'Retornar resultado ao computador2':[2480,3520], 'Reunir aspectos e definir rotas':[3376,2616],
    'Respostas Jev válidas?':[3616,2616], 'Agent: Escrivão do Diário':[3936,2600],
    'OpenRouter — Diário e Conquistas':[3952,2808], 'Schema — Diário':[4128,2808],
    'Validar título e resumo':[4368,2600], 'Preparar ações dos aspectos true':[4624,2600],
    'Rotear aspectos true':[4880,2600], 'Agent: Escrivão Brag Document':[5216,2000],
    'OpenRouter — Diário e Conquistas1':[5232,2208], 'Schema — Brag Document':[5408,2208],
    'Validar conquistas e trecho literal':[5600,2000], 'Registrar resultado da ação':[5952,2656],
    'Montar Diário e Conquistas completos':[6208,2656], 'Retornar resultado ao computador':[6464,2656],
    'Obstáculo — conectar ação aqui':[5248,2448], 'História — conectar ação aqui':[5248,2640],
    'Gratidão — conectar ação aqui':[5248,2848], 'Piada — conectar ação aqui':[5248,3040],
    'Vida pessoal — conectar ação aqui':[5248,3248], 'Nenhum aspecto true — seguir':[5248,3440],
  };
  jevs.forEach((name, i) => { positions[name] = [2768,2016 + i*240]; });
  for (const [name, position] of Object.entries(positions)) find(name).position = position;
  find('Sticky Note 0a16bcc8').parameters.content = '## Diário e Conquistas\n\nCada input gera seu registro do Diário.\n\nOs seis Jevs são avaliados em caminhos independentes, reunidos antes do roteamento. Todos os aspectos true seguem seus respectivos caminhos, sem loop.\n\nVitória chama o Brag. Os demais aspectos mantêm os pontos “conectar ação aqui”. Sem aspectos true, o Diário também é concluído.\n\nA montagem final espera todos os caminhos selecionados e conserva os resultados e erros de Diário/Brag.';
  for (const n of w.nodes) if (JSON.stringify(n.parameters).includes(loop)) throw new Error('Referência ao loop ainda presente: ' + n.name);
  return w;
}
