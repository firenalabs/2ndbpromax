function segmentText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('O texto está vazio.');
  if (typeof Intl.Segmenter !== 'function') throw new Error('Este ambiente não oferece segmentação de frases.');
  const maxWords = 50;
  const segments = [];
  for (const part of new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(text)) {
    const words = [...part.segment.matchAll(/\S+/gu)];
    if (!words.length) continue;
    // Long unpunctuated passages need deterministic anchors, not invented sentences.
    const chunkCount = Math.ceil(words.length / maxWords);
    const chunkSize = Math.ceil(words.length / chunkCount);
    for (let i = 0; i < words.length; i += chunkSize) {
      const next = i + chunkSize;
      segments.push({
        id: `SEG_${String(segments.length + 1).padStart(5, '0')}`,
        start: part.index + (i === 0 ? 0 : words[i].index),
        end: next < words.length ? part.index + words[next].index : part.index + part.segment.length,
      });
    }
  }
  return {
    version: 'sentence-pt-BR-v2', locale: 'pt-BR', offsetUnit: 'utf16',
    strategy: 'sentences-with-word-fallback', maxWordsPerSegment: maxWords, segments,
  };
}
const payload = $input.first().json.body ?? $input.first().json;
if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('Envie um texto não vazio.');
if (!/^[a-f0-9-]{36}$/.test(payload.sourceId ?? '') || payload.digestId !== payload.sourceId + '-digest-v1') throw new Error('Identidade de origem inválida.');
if (typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error('Data de origem inválida.');
if (payload.text.length > 120000) throw new Error('Texto acima do limite de 120.000 caracteres do protótipo.');
const segmentation = segmentText(payload.text);
const segmentedText = segmentation.segments.map(s => '[' + s.id + '] ' + payload.text.slice(s.start, s.end).trim()).join('\n');
return [{ json: { ...payload, segmentation, segmentedText } }];
