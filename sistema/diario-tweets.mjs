// Functions embedded in the n8n Code nodes; Agent prompts remain unchanged.
export function splitDiaryAngles(value, context) {
  const fail = message => [{ ...context, error: { message } }];
  if (value.error) return fail(String(value.error.message ?? value.error));
  let output = value.output;
  if (typeof output === 'string') {
    const trimmed = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
    try { output = JSON.parse(trimmed); } catch { output = trimmed.split(/^\s*---+\s*$/m); }
  }
  const angles = Array.isArray(output) ? output : output?.angles ?? output?.angulos;
  if (!Array.isArray(angles) || !angles.length || angles.some(angle => typeof angle !== 'string' || !angle.trim())) {
    return fail('O Agent de ângulos não retornou uma lista válida de ângulos.');
  }
  return angles.map((angle, index) => ({ ...context, angle: angle.trim(), tweetIndex: index + 1,
    texto: `${context.text}\n\nÂngulo deste item: ${angle.trim()}`, error: null }));
}

export function structureDiaryTweets(value, context) {
  const fail = message => ({ generatedContents: [], generatedContentErrors: [{ origin: 'diario',
    referenceId: context.referenceId, tweetIndex: context.tweetIndex ?? 1, message }] });
  if (value.error) return fail(String(value.error.message ?? value.error));
  let output = value.output;
  if (typeof output === 'string') {
    const trimmed = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
    try { output = JSON.parse(trimmed); } catch { output = trimmed; }
  }
  const tweets = Array.isArray(output) ? output : Array.isArray(output?.tweets) ? output.tweets : [output];
  if (!tweets.length) return fail('O Agent não retornou tweets.');
  const generatedContents = [], generatedContentErrors = [], now = new Date().toISOString();
  for (const [index, tweet] of tweets.entries()) {
    const body = typeof tweet === 'string' ? tweet.trim() : typeof tweet?.text === 'string' ? tweet.text.trim()
      : typeof tweet?.body === 'string' ? tweet.body.trim() : '';
    if (!body) { generatedContentErrors.push(...fail(`Tweet ${index + 1} vazio ou inválido.`).generatedContentErrors); continue; }
    const tweetIndex = context.tweetIndex ?? index + 1;
    const contentKey = context.tweetIndex ? `tweet-${tweetIndex}${tweets.length > 1 ? `-${index + 1}` : ''}` : `tweet-${index + 1}`;
    const title = (typeof tweet?.title === 'string' && tweet.title.trim() ? tweet.title.trim()
      : context.angle ?? body.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? body.split('\n').find(line => line.trim()) ?? 'Tweet').slice(0, 150);
    generatedContents.push({ schemaVersion: 1, origin: 'diario', referenceId: context.referenceId,
      sourceIds: context.contentSourceIds, contentKey, tweetIndex, angle: context.angle ?? null,
      createdAt: now, updatedAt: now, title, body, sourceWordCount: context.sourceWordCount,
      wordCount: (body.match(/\S+/g) ?? []).length });
  }
  return { generatedContents, generatedContentErrors };
}
