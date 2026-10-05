import { validateDigest } from './contratos.mjs';

export function validateCategories(categories, maxDepth) {
  if (!Array.isArray(categories) || !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 4) throw new Error('Árvore ou profundidade de categorias inválida.');
  const ids = new Map(categories.map(c => [c.id, c]));
  const names = new Set();
  if (ids.size !== categories.length) throw new Error('Categorias duplicadas.');
  for (const c of categories) {
    if (typeof c.id !== 'string' || !c.id || c.id === 'none' || typeof c.name !== 'string' || !c.name.trim() || typeof c.description !== 'string') throw new Error('Categoria inválida.');
    const name = `${c.parentId}:${c.name.trim().normalize('NFC').toLocaleLowerCase('pt-BR')}`;
    if (names.has(name)) throw new Error('Categorias com mesmo nome no mesmo nível.');
    names.add(name);
    let parent = c; const visited = new Set();
    while (parent) {
      if (visited.has(parent.id)) throw new Error('Ciclo de categorias.');
      visited.add(parent.id);
      if (parent.parentId !== null && !ids.has(parent.parentId)) throw new Error('Pai de categoria inexistente.');
      parent = parent.parentId === null ? null : ids.get(parent.parentId);
    }
    if (visited.size > maxDepth) throw new Error('Profundidade excedida.');
  }
  return categories;
}

export function selectCategory(context, decision) {
  const selected = context.tree.find(c => c.id === decision.choice && c.parentId === context.parentId);
  if (!selected) throw new Error('Categoria escolhida fora do nível atual.');
  const ancestors = [...context.ancestors, { id: selected.id, name: selected.name, description: selected.description }];
  const complete = ancestors.length >= context.maxCategoryDepth || !context.tree.some(c => c.parentId === selected.id);
  return { ...context, parentId: selected.id, ancestors, complete,
    block: { ...context.block, routingDecisions: [...context.block.routingDecisions, { parentId: context.parentId, ...decision }],
      ...(complete ? { status: 'accepted', categoryId: selected.id } : {}) } };
}

export function addCategoryPath(context, path) {
  const categories = context.tree.map(c => ({ ...c }));
  let parentId = context.parentId;
  for (const [i, proposed] of path.entries()) {
    const normalized = proposed.name.trim().normalize('NFC').toLocaleLowerCase('pt-BR');
    let category = categories.find(c => c.parentId === parentId && c.name.trim().normalize('NFC').toLocaleLowerCase('pt-BR') === normalized);
    if (!category) {
      const id = `${context.block.id}-category-${context.ancestors.length + i + 1}`;
      if (categories.some(c => c.id === id)) throw new Error('Identidade de categoria já utilizada.');
      const now = new Date().toISOString();
      category = { id, createdAt: now, updatedAt: now, schemaVersion: 1, parentId, ...proposed, noteIds: [] };
      categories.push(category);
    }
    parentId = category.id;
  }
  return { ...context, tree: categories, complete: true,
    block: { ...context.block, categoryId: parentId, status: 'accepted', routingDecisions: [...context.block.routingDecisions, ...(context.decision ? [{ parentId: context.parentId, ...context.decision }] : [])] } };
}

export function buildBlocks(digest) {
  validateDigest(digest, { id: digest.sourceId, digestId: digest.id, text: digest.originalText });
  const positions = new Map(digest.segmentation.segments.map(s => [s.id, s.start]));
  const blocks = digest.keytopics.map((topic, index) => {
    const next = digest.keytopics[index + 1];
    const start = index === 0 ? 0 : positions.get(topic.id);
    const end = next ? positions.get(next.id) : digest.originalText.length;
    const text = digest.originalText.slice(start, end);
    if (!text.trim()) throw new Error('O corte produziria um bloco vazio.');
    return {
      id: `${digest.sourceId}-${topic.id}-block-v1`, sourceId: digest.sourceId, digestId: digest.id,
      createdAt: digest.createdAt, updatedAt: digest.updatedAt, schemaVersion: 1,
      segmentId: topic.id, endSegmentIdExclusive: next?.id ?? null, start, end,
      text, keytopic: topic.title, bulletpoints: [...topic.bulletpoints],
      wordCount: (text.match(/\S+/g) ?? []).length, title: null, categoryId: null,
      knowledge: null, routingDecisions: [], status: 'created',
    };
  });
  if (blocks.map(b => b.text).join('') !== digest.originalText) throw new Error('Os cortes perderam conteúdo do original.');
  return blocks;
}

export function validateBlock(block, expected) {
  for (const key of ['id', 'sourceId', 'digestId', 'createdAt', 'schemaVersion', 'segmentId', 'endSegmentIdExclusive', 'start', 'end', 'text', 'keytopic', 'wordCount']) {
    if (block?.[key] !== expected[key]) throw new Error(`O recorte alterou o campo ${key}.`);
  }
  if (JSON.stringify(block.bulletpoints) !== JSON.stringify(expected.bulletpoints)) throw new Error('Os bullet points do recorte foram alterados.');
  if (!['created', 'prepared', 'filtered', 'accepted'].includes(block.status)) throw new Error('Estado de recorte inválido.');
  return block;
}

export function readKnowledge(response, threshold) {
  const answer = response?.answers?.conhecimento_util;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Limiar de conhecimento inválido.');
  if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new Error('Jev não retornou uma probabilidade válida de conhecimento.');
  }
  return { probability: answer.noul, threshold, accepted: answer.noul >= threshold, model: 'typesafe/jev-1.13', evaluatedAt: new Date().toISOString() };
}

export function readChoice(response, categories) {
  const answer = response?.answers?.categoria;
  const options = new Set([...categories.map(c => c.id), 'none']);
  if (answer?.type !== 'choice' || !options.has(answer.choice) || !answer.probabilities || typeof answer.probabilities !== 'object') {
    throw new Error('Jev não retornou uma categoria válida.');
  }
  for (const id of options) {
    const p = answer.probabilities[id];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('Distribuição de categorias inválida.');
  }
  if (Object.keys(answer.probabilities).some(id => !options.has(id))) throw new Error('Jev retornou uma opção que não foi enviada.');
  if (answer.confidence !== undefined && (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) throw new Error('Confiança de categoria inválida.');
  return { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence ?? null, model: 'typesafe/jev-1.13', evaluatedAt: new Date().toISOString() };
}

export function validateCategoryPath(path, remainingDepth, isRoot) {
  if (!Array.isArray(path) || !path.length || path.length > Math.min(remainingDepth, isRoot ? 2 : 1)) throw new Error('O Agent retornou um caminho de categorias inválido.');
  for (const category of path) {
    if (typeof category?.name !== 'string' || !category.name.trim() || category.name.trim().length > 100
      || typeof category.description !== 'string' || !category.description.trim()) throw new Error('Categoria sem nome ou descrição válida.');
  }
  return path.map(c => ({ name: c.name.trim().normalize('NFC'), description: c.description.trim() }));
}
