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
const source = $('Validar entrada e adicionar SEGs').first().json;
try {
  const response = $input.first().json;
  if (response.error) throw new Error('O Agent não conseguiu concluir a digestão.');
  let result = response.output;
  if (typeof result === 'string') result = JSON.parse(result);
  const digest = {
    ok: true, id: source.digestId, sourceId: source.sourceId, createdAt: source.createdAt,
    updatedAt: new Date().toISOString(), schemaVersion: 1,
    originalText: source.text, segmentedText: source.segmentedText,
    segmentation: source.segmentation, keytopics: result?.keytopics,
    processing: { promptVersion: 'keytopics-codex-v2', model: 'google/gemini-3.1-flash-lite' }
  };
  validateDigest(digest, { id: source.sourceId, digestId: source.digestId, text: source.text });
  return [{ json: digest }];
} catch (error) {
  return [{ json: { ok: false, sourceId: source.sourceId, error: { message: error.message, code: 'INVALID_KEYTOPICS', segmentCount: source.segmentation.segments.length } } }];
}
