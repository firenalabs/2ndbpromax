// Simplificação determinística: não modifica Agents, chamadas, cache ou layout.
export const editorialAdapters = {
  'Preparar input carrossel — lista': 'Conferir cache — carrossel - linguagem flesch 8-9 ano',
  'Preparar input carrossel — checklist': 'Conferir cache — carrossel - linguagem flesch 8-9 ano3',
  'Preparar input carrossel — tutorial': 'Conferir cache — carrossel - linguagem flesch 8-9 ano1',
  'Preparar primeiro bloco da thread1': 'Conferir cache — thread1',
  'Preparar input carrossel — storytelling1': 'Conferir cache — carrossel - linguagem flesch 8-9 ano4',
  'Preparar legenda com slides': 'Conferir cache — Legenda completa instagram',
  'Preparar legenda com slides1': 'Conferir cache — Legenda completa instagram1',
};
const bands = ['0 a 100', '101 a 200', '201 a 400', '401 a 800', '801 a 1600', '1601 a 3200', '3200+'];

// Os helpers antigos têm declarações no início e um marcador antes do corpo.
// Mantém somente helpers alcançáveis pelo corpo, incluindo dependências indiretas.
export function trimSocialHelpers(code) {
  const marker = "const socialNetworks=['Twitter','LinkedIn','Instagram'];";
  const end = code.indexOf(marker);
  if (!code.startsWith('function collectSocialResults(') || end < 0) return code;
  const matches = [...code.slice(0, end).matchAll(/^function (\w+)\(/gm)];
  const helpers = new Map(matches.map((m, i) => [m[1], code.slice(m.index, matches[i + 1]?.index ?? end)]));
  const body = code.slice(end + marker.length).trimStart();
  const retained = new Set();
  const visit = text => {
    for (const [name, helper] of helpers) {
      if (!retained.has(name) && new RegExp('\\b' + name + '\\b').test(text)) {
        retained.add(name); visit(helper);
      }
    }
  };
  visit(body);
  const prefix = [...helpers].filter(([name]) => retained.has(name)).map(([, helper]) => helper).join('');
  return prefix + (/\bsocialNetworks\b/.test(prefix + body) ? marker + '\n\n' : '') + body;
}

export function simplifyEditorial(workflow) {
  const w = structuredClone(workflow);
  if (!w.nodes.some(n => n.name === 'Validar pedido do Atlas')) return w;
  const find = name => {
    const n = w.nodes.find(n => n.name === name);
    if (!n) throw new Error('Node esperado ausente: ' + name);
    return n;
  };
  const removed = new Set(['Validar pedido do Diário', 'Validar pedido do Atlas', ...bands, ...Object.keys(editorialAdapters)]);
  for (const name of removed) {
    const n = find(name);
    if (n.type !== 'n8n-nodes-base.code') throw new Error('Somente adaptadores Code podem ser removidos.');
    if ((w.connections[name]?.main?.length ?? 0) !== 1) throw new Error('Adaptador com saídas inesperadas: ' + name);
  }
  // Guarda os metadados de cada faixa; apenas transfere seu cálculo à contagem.
  const families = bands.map(name => {
    const match = find(name).parameters.jsCode.match(/expectedFamilies:(\[[^\]]*\])/);
    if (!match) throw new Error('Faixa sem metadados esperados: ' + name);
    return JSON.parse(match[1]);
  });
  const count = find('Contar palavras para conteúdo — Diário1');
  const tail = 'sourceWordCount:(text.match(/\\S+/g)??[]).length';
  if (!count.parameters.jsCode.includes(tail)) throw new Error('Contagem mudou; revisar antes de unir faixas.');
  count.parameters.jsCode = 'const editorialFamilies=' + JSON.stringify(families) + ';\n' + count.parameters.jsCode.replace(tail,
    tail + ',expectedFamilies:editorialFamilies[[100,200,400,800,1600,3200,Infinity].findIndex(limit=>(text.match(/\\S+/g)??[]).length<=limit)]');
  for (const [old, next] of Object.entries(editorialAdapters)) {
    const n = find(next);
    if (!find(old).parameters.jsCode.includes('texto: item.json.text')) continue;
    const original = '...item.json,_replayStage:';
    if (!n.parameters.jsCode.includes(original)) throw new Error('Cache mudou: ' + next);
    n.parameters.jsCode = n.parameters.jsCode.replace(original, '...item.json,texto:item.json.text,_replayStage:');
  }
  // Só altera referências de contexto em Code; prompts nunca são reescritos.
  for (const n of w.nodes.filter(n => n.type === 'n8n-nodes-base.code' && n.name !== 'Ver todos os outputs dos Agents')) {
    let code = trimSocialHelpers(n.parameters.jsCode);
    for (const [old, next] of Object.entries(editorialAdapters)) for (const quote of ["'", '"']) {
      code = code.replaceAll('$(' + quote + old + quote + ')', '$(' + quote + next + quote + ')');
    }
    n.parameters.jsCode = code;
  }
  const expand = (edge, visited = new Set()) => {
    if (!removed.has(edge.node)) return [edge];
    if (visited.has(edge.node)) throw new Error('Ciclo entre adaptadores.');
    const path = new Set([...visited, edge.node]);
    return (w.connections[edge.node]?.main?.[0] ?? []).flatMap(e => expand(e, path));
  };
  // Substitui cada adaptador por seus sucessores na mesma posição da lista.
  // Preserva a ordem dos ramos e os índices de saída do node anterior.
  for (const [name, channels] of Object.entries(w.connections)) {
    if (removed.has(name)) continue;
    if (channels.main) channels.main = channels.main.map(batch => batch.flatMap(e => expand(e)));
  }
  for (const name of removed) delete w.connections[name];
  w.nodes = w.nodes.filter(n => !removed.has(n.name));
  const collector = find('Ver todos os outputs dos Agents');
  const graphMatch = collector.parameters.jsCode.match(/const graph=(\[.*?\]);/);
  const namesMatch = collector.parameters.jsCode.match(/const names=(\[.*?\]);/);
  if (!graphMatch || !namesMatch) throw new Error('Inventário do coletor mudou.');
  // Conexões reais, incluindo as novas ligações diretas; não inclui o coletor.
  const excludedTargets = new Set(['Ver todos os outputs dos Agents', 'Retornar comparação editorial']);
  const graph = Object.entries(w.connections).flatMap(([source, channels]) =>
    (channels.main ?? []).flatMap((batch, output) => batch.map(e => ({source, target:e.node, output}))))
    .filter(e => !excludedTargets.has(e.target) && e.source !== collector.name && e.source !== 'Organizar posts e checkpoints');
  const names = JSON.parse(namesMatch[1]).filter(name => !removed.has(name));
  collector.parameters.jsCode = collector.parameters.jsCode
    .replace(graphMatch[0], 'const graph=' + JSON.stringify(graph) + ';')
    .replace(namesMatch[0], 'const names=' + JSON.stringify(names) + ';');
  for (const n of w.nodes) {
    for (const match of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
      if (removed.has(match[1])) throw new Error('Referência removida ainda presente: ' + n.name);
    }
  }
  return w;
}
