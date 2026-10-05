export function countContentWords(text) {
  if (typeof text !== 'string') throw new Error('Texto inválido para contagem de palavras.');
  return (text.match(/\S+/g) ?? []).length;
}

export function contentWebhookFor(config) {
  if (config.contentWebhook) return config.contentWebhook;
  const url = new URL(config.diaryWebhook);
  const prefix = url.pathname.match(/^(.*)\/webhook\//)?.[1] ?? '';
  url.pathname = `${prefix}/webhook/segundo-cerebro-local-conteudos-v1`;
  url.search = ''; url.hash = '';
  return url.href;
}

export function contentRange(text) {
  const count = countContentWords(text);
  return count <= 150 ? null : count <= 600 ? '151 a 600' : count <= 1499 ? '601 a 1499' : '1500+';
}

export function structureGeneratedContent(output, text) {
  const range = contentRange(text);
  if (!range) return null;
  if (typeof output === 'string') output = JSON.parse(output);
  if (typeof output?.title !== 'string' || !output.title.trim() || output.title.trim().length > 150 || /[\r\n]/.test(output.title)
    || typeof output.body !== 'string' || !output.body.trim() || output.body.length > 60000) throw new Error('O Agent de conteúdo precisa retornar title e body válidos.');
  const body = output.body.trim();
  return { schemaVersion: 1, title: output.title.trim(), body,
    format: { '151 a 600': 'texto_curto', '601 a 1499': 'artigo', '1500+': 'ensaio' }[range],
    wordRange: range, sourceWordCount: countContentWords(text), wordCount: countContentWords(body),
    promptVersion: 'conteudos-codex-v1' };
}

export function validateGeneratedContent(value, text) {
  const expected = structureGeneratedContent(value, text);
  if (!expected || !value) throw new Error('Conteúdo ausente ou recebido para uma faixa sem geração.');
  for (const key of ['schemaVersion', 'format', 'wordRange', 'sourceWordCount', 'wordCount', 'promptVersion']) {
    if (value[key] !== expected[key]) throw new Error(`Metadado inválido do conteúdo: ${key}.`);
  }
  return expected;
}
