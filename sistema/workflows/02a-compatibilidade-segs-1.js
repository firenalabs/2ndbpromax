function letterAddress(number) {
  let result = '';
  while (number > 0) { number--; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
  return result;
}
function letterOrdinal(value) {
  return [...value].reduce((total, c) => total * 26 + c.charCodeAt(0) - 64, 0);
}
function nextNoteAddress(categories, notes, categoryId, parentNoteId) {
  const parent = parentNoteId === null ? categories.find(c => c.id === categoryId) : notes.find(n => n.id === parentNoteId);
  if (!parent) throw new Error('Pai da nota inexistente.');
  const letters = parent.address.split('.').length % 2 === 0;
  const siblings = notes.filter(n => n.categoryId === categoryId && n.parentNoteId === parentNoteId);
  const last = Math.max(0, ...siblings.map(n => letters ? letterOrdinal(n.address.split('.').at(-1)) : Number(n.address.split('.').at(-1))));
  return `${parent.address}.${letters ? letterAddress(last + 1) : last + 1}`;
}
function validateZettelTree(categories, notes) {
  if (!Array.isArray(categories) || !Array.isArray(notes)) throw new Error('Árvore do Atlas inválida.');
  const roots = new Map(); const ids = new Set(); const addresses = new Set(); const names = new Set();
  for (const c of categories) {
    if (!c || typeof c.id !== 'string' || !c.id || c.id === 'none' || ids.has(c.id) || c.parentId !== null
      || typeof c.name !== 'string' || !c.name.trim() || /[\r\n]/.test(c.name) || typeof c.description !== 'string' || !Array.isArray(c.noteIds)
      || !/^[A-Z]+$/.test(c.address)) throw new Error('Categoria raiz inválida ou duplicada.');
    const name = c.name.trim().normalize('NFC').toLocaleLowerCase('pt-BR');
    if (names.has(name)) throw new Error('Categorias com mesmo nome.');
    if (addresses.has(c.address)) throw new Error('Endereço duplicado.');
    names.add(name); ids.add(c.id); addresses.add(c.address); roots.set(c.id, c);
  }
  const byId = new Map();
  for (const n of notes) {
    if (!n || typeof n.id !== 'string' || !n.id || n.id === 'none' || ids.has(n.id) || typeof n.title !== 'string' || !n.title.trim()
      || n.title.length > 150 || /[\r\n]/.test(n.title) || !roots.has(n.categoryId) || (n.parentNoteId !== null && typeof n.parentNoteId !== 'string')
      || typeof n.address !== 'string' || addresses.has(n.address)) throw new Error('Nota ou endereço inválido ou duplicado.');
    for (const field of ['noteFile','legacyNoteFile']) if (n[field] !== undefined && (typeof n[field] !== 'string' || /[\\/]/.test(n[field]) || n[field] === '.' || n[field] === '..')) throw new Error('Nome de arquivo de nota inválido.');
    ids.add(n.id); addresses.add(n.address); byId.set(n.id, n);
  }
  for (const n of notes) {
    const parent = n.parentNoteId === null ? roots.get(n.categoryId) : byId.get(n.parentNoteId);
    if (!parent || (n.parentNoteId !== null && parent.categoryId !== n.categoryId)) throw new Error('Pai da nota inexistente ou em outra categoria.');
    const suffix = n.address.slice(parent.address.length + 1);
    const letters = parent.address.split('.').length % 2 === 0;
    if (!n.address.startsWith(parent.address + '.') || !(letters ? /^[A-Z]+$/ : /^[1-9][0-9]*$/).test(suffix)) throw new Error('Endereço da nota diverge do pai.');
    let cursor = n; const visited = new Set();
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error('Ciclo de notas.');
      visited.add(cursor.id); cursor = cursor.parentNoteId === null ? null : byId.get(cursor.parentNoteId);
    }
  }
  return { categories, notes };
}
function insertZettelNote(context) {
  if (!context.categoryId) throw new Error('Selecione uma categoria raiz antes de posicionar a nota.');
  if (context.noteTree.some(n => n.id === context.block.id)) throw new Error('Nota já posicionada.');
  const address = nextNoteAddress(context.tree, context.noteTree, context.categoryId, context.parentNoteId);
  const note = { id: context.block.id, sourceId: context.block.sourceId, digestId: context.block.digestId,
    createdAt: context.block.createdAt, updatedAt: new Date().toISOString(), schemaVersion: 2,
    categoryId: context.categoryId, parentNoteId: context.parentNoteId, address, title: context.block.title };
  const routingDecisions = [...context.block.routingDecisions, ...(context.decision ? [{ level: 'notes', parentId: context.parentNoteId ?? context.categoryId, ...context.decision }] : [])];
  return { ...context, complete: true, noteTree: [...context.noteTree, note],
    block: { ...context.block, categoryId: note.categoryId, parentNoteId: note.parentNoteId, address, routingDecisions, status: 'accepted' } };
}
function advanceZettel(context, decision) {
  if (decision.choice === 'none') return insertZettelNote({ ...context, decision });
  const roots = context.categoryId === null;
  const selected = roots ? context.tree.find(c => c.id === decision.choice)
    : context.noteTree.find(n => n.id === decision.choice && n.categoryId === context.categoryId && n.parentNoteId === context.parentNoteId);
  if (!selected) throw new Error('Escolha fora do nível atual.');
  if (context.ancestors.some(a => a.id === selected.id)) throw new Error('Ciclo no roteamento da nota.');
  return { ...context, categoryId: roots ? selected.id : context.categoryId, parentNoteId: roots ? null : selected.id,
    ancestors: [...context.ancestors, { id: selected.id, address: selected.address, title: roots ? selected.name : selected.title }], complete: false,
    block: { ...context.block, routingDecisions: [...context.block.routingDecisions, { level: roots ? 'categories' : 'notes', parentId: roots ? null : context.parentNoteId ?? context.categoryId, ...decision }] } };
}
function createZettelRoot(context, path) {
  if (context.categoryId !== null || !Array.isArray(path) || path.length !== 1) throw new Error('Somente uma categoria de primeiro nível pode ser criada.');
  const proposed = path[0];
  if (typeof proposed?.name !== 'string' || !proposed.name.trim() || proposed.name.trim().length > 100 || typeof proposed.description !== 'string' || !proposed.description.trim()) throw new Error('Categoria sem nome ou descrição válida.');
  const name = proposed.name.trim().normalize('NFC').replace(/\s+/g, ' ');
  let category = context.tree.find(c => c.name.trim().normalize('NFC').toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
  let tree = context.tree;
  if (!category) {
    const now = new Date().toISOString();
    category = { id: `${context.block.id}-category-root-v2`, createdAt: now, updatedAt: now, schemaVersion: 2, parentId: null,
      address: letterAddress(Math.max(0, ...tree.map(c => letterOrdinal(c.address))) + 1), name, description: proposed.description.trim(), noteIds: [] };
    if (tree.some(c => c.id === category.id)) throw new Error('Identidade de categoria já utilizada.');
    tree = [...tree, category];
  }
  const block = { ...context.block, routingDecisions: [...context.block.routingDecisions, ...(context.decision ? [{ level: 'categories', parentId: null, ...context.decision }] : [])] };
  return insertZettelNote({ ...context, tree, block, categoryId: category.id, parentNoteId: null, decision: null });
}
function validateDigest(digest, source) {
  if (!digest || typeof digest !== 'object' || Array.isArray(digest)) throw new Error('A digestão recebida não é um objeto.');
  if (digest.sourceId !== source.id || digest.id !== source.digestId) throw new Error('A digestão não corresponde à origem enviada.');
  if (digest.originalText !== source.text) throw new Error('O processamento alterou o texto original.');
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof digest[key] !== 'string' || !Number.isFinite(Date.parse(digest[key]))) throw new Error(`Data inválida: ${key}.`);
  }
  const segmentation = digest.segmentation;
  if (!segmentation || segmentation.offsetUnit !== 'utf16') throw new Error('O mapa de segmentos precisa usar posições UTF-16 (offsetUnit: utf16).');
  const segments = segmentation.segments;
  if (!Array.isArray(segments) || !segments.length) throw new Error('O mapa de segmentos está vazio.');
  let lastEnd = 0;
  const ids = new Map();
  segments.forEach((segment, index) => {
    const expectedId = `SEG_${String(index + 1).padStart(5, '0')}`;
    if (segment.id !== expectedId || !Number.isInteger(segment.start) || !Number.isInteger(segment.end)
      || segment.start < lastEnd || segment.end <= segment.start || segment.end > source.text.length
      || source.text.slice(lastEnd, segment.start).trim() || !source.text.slice(segment.start, segment.end).trim()) {
      throw new Error(`Segmento inválido: ${expectedId}.`);
    }
    lastEnd = segment.end;
    ids.set(segment.id, index);
  });
  if (source.text.slice(lastEnd).trim()) throw new Error('O mapa de segmentos perdeu conteúdo do final.');
  const expectedText = segments.map(s => `[${s.id}] ${source.text.slice(s.start, s.end).trim()}`).join('\n');
  if (digest.segmentedText !== expectedText) throw new Error('O texto segmentado não corresponde ao mapa.');
  if (!Array.isArray(digest.keytopics) || !digest.keytopics.length) throw new Error('Nenhum KeyTopic foi recebido.');
  let lastIndex = -1;
  digest.keytopics.forEach((topic, index) => {
    const position = ids.get(topic?.id);
    if (position === undefined) throw new Error(`KeyTopic ${index + 1}: ID ${JSON.stringify(topic?.id)} inexistente; copie um SEG do texto segmentado.`);
    if (position <= lastIndex) throw new Error(`KeyTopic ${index + 1}: ${topic.id} está repetido ou fora de ordem após ${digest.keytopics[index - 1].id}; use IDs únicos e crescentes.`);
    if (typeof topic.title !== 'string' || !topic.title.trim()
      || !Array.isArray(topic.bulletpoints) || !topic.bulletpoints.length
      || topic.bulletpoints.some(b => typeof b !== 'string' || !b.trim())) {
      throw new Error(`Título ou bullet points inválidos em ${topic.id}.`);
    }
    lastIndex = position;
  });
  return digest;
}
function buildBlocks(digest) {
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
function validateBlock(block, expected) {
  for (const key of ['id', 'sourceId', 'digestId', 'createdAt', 'schemaVersion', 'segmentId', 'endSegmentIdExclusive', 'start', 'end', 'text', 'keytopic', 'wordCount']) {
    if (block?.[key] !== expected[key]) throw new Error(`O recorte alterou o campo ${key}.`);
  }
  if (JSON.stringify(block.bulletpoints) !== JSON.stringify(expected.bulletpoints)) throw new Error('Os bullet points do recorte foram alterados.');
  if (!['created', 'prepared', 'filtered', 'accepted'].includes(block.status)) throw new Error('Estado de recorte inválido.');
  return block;
}
try {
const input=$input.first().json.body ?? $input.first().json;
if(input.operation!=='process'||input.atlasSchemaVersion!==2)throw new Error('Atualize e reinicie o programa local para o Atlas Zettelkasten v2.');
if(!Number.isFinite(input.knowledgeThreshold)||input.knowledgeThreshold<=0||input.knowledgeThreshold>1)throw new Error('Limiar inválido.');
validateZettelTree(input.categories,input.notes);
if(input.categories.length>254)throw new Error('Mais de 254 categorias raiz.');
if(!input.digest||input.digest.originalText?.length>120000||!Array.isArray(input.blocks)||!input.blocks.length)throw new Error('Digestão ou recortes inválidos.');
const expected=buildBlocks(input.digest);const ids=new Set();
for(const block of input.blocks){const original=expected.find(b=>b.id===block.id);if(!original||ids.has(block.id)||!['created','prepared'].includes(block.status)||input.notes.some(n=>n.id===block.id))throw new Error('Recorte pendente inválido.');ids.add(block.id);validateBlock(block,original);}
return [{json:{...input,ok:true}}];
}catch(error){return [{json:{ok:false,error:{message:error.message}}}];}
