export function letterAddress(number) {
  let result = '';
  while (number > 0) { number--; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
  return result;
}

export function letterOrdinal(value) {
  return [...value].reduce((total, c) => total * 26 + c.charCodeAt(0) - 64, 0);
}

export function nextNoteAddress(categories, notes, categoryId, parentNoteId) {
  const parent = parentNoteId === null ? categories.find(c => c.id === categoryId) : notes.find(n => n.id === parentNoteId);
  if (!parent) throw new Error('Pai da nota inexistente.');
  const letters = parent.address.split('.').length % 2 === 0;
  const siblings = notes.filter(n => n.categoryId === categoryId && n.parentNoteId === parentNoteId);
  const last = Math.max(0, ...siblings.map(n => letters ? letterOrdinal(n.address.split('.').at(-1)) : Number(n.address.split('.').at(-1))));
  return `${parent.address}.${letters ? letterAddress(last + 1) : last + 1}`;
}

export function validateZettelTree(categories, notes) {
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

export function insertZettelNote(context) {
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

export function advanceZettel(context, decision) {
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

export function createZettelRoot(context, path) {
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

export function zettelFilename(note) {
  const title = note.title.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/[. ]+$/g, '').trim() || 'Nota';
  if (!Number.isInteger(note.wordCount) || note.wordCount < 0) throw new Error('Quantidade de palavras da nota inválida.');
  const prefix = `${note.address} - ${note.wordCount} ${note.wordCount === 1 ? 'palavra' : 'palavras'} - `;
  if (Buffer.byteLength(prefix + '.md', 'utf8') > 220) throw new Error('Endereço longo demais para o nome do arquivo.');
  let safe = '';
  for (const c of title) { if (Buffer.byteLength(prefix + safe + c + '.md', 'utf8') > 240) break; safe += c; }
  return prefix + safe.replace(/[. ]+$/g, '') + '.md';
}
