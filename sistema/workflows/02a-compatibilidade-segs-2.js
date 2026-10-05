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
    if (index === 0 && position !== 0) throw new Error(`O primeiro KeyTopic começa em ${topic.id}, mas precisa começar em ${segments[0].id} para incluir a introdução.`);
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
const input=$input.first().json;
const expected=buildBlocks(input.digest);return input.blocks.map(block=>{validateBlock(block,expected.find(b=>b.id===block.id));return {json:{block,tree:input.categories,noteTree:input.notes,knowledgeThreshold:input.knowledgeThreshold},pairedItem:{item:0}};});
