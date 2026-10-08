export const socialNetworks = ['Twitter', 'LinkedIn', 'Instagram'];

export function parseSocialOutput(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  try { return JSON.parse(text); } catch { return text; }
}

export function socialText(value) {
  return typeof value === 'string' ? value.trim()
    : typeof value?.text === 'string' ? value.text.trim()
      : typeof value?.body === 'string' ? value.body.trim() : '';
}

export function socialParts(value) {
  const parsed = parseSocialOutput(value);
  const parts = Array.isArray(parsed) ? parsed : parsed?.parts ?? parsed?.slides
    ?? (typeof parsed === 'string' ? parsed.split(/^\s*---+\s*$/m) : [parsed]);
  if (!Array.isArray(parts) || !parts.length || parts.some(part => !socialText(part))) throw new Error('Partes vazias ou inválidas.');
  return parts.map(socialText);
}

export function socialPosts(value) {
  const parsed = parseSocialOutput(value);
  const posts = Array.isArray(parsed) ? parsed : parsed?.posts
    ?? (typeof parsed === 'string' ? parsed.split(/^\s*---+\s*$/m).filter(part => part.trim()) : [parsed]);
  if (!Array.isArray(posts) || !posts.length || posts.some(post => !socialText(post))) throw new Error('Posts vazios ou inválidos.');
  return posts.map(socialText);
}

export function socialError(error, context, stage) {
  return { origin: 'diario', referenceId: context.referenceId, stage,
    message: String(error?.message ?? error) };
}

export function makeSocialRecord(context, socialNetwork, contentType, format, key, parts, extra = {}) {
  const now = new Date().toISOString();
  const body = extra.body ?? parts.join('\n\n---\n\n');
  const title = (extra.title ?? context.angle ?? parts[0].replace(/^#+\s*/, '').split('\n')[0]).slice(0, 150);
  return { schemaVersion: 2, origin: 'diario', referenceId: context.referenceId,
    sourceIds: context.contentSourceIds, contentKey: `${key}:${socialNetwork}`, socialNetwork,
    contentType, format, parts, title, body, createdAt: now, updatedAt: now,
    sourceWordCount: context.sourceWordCount, wordCount: (body.match(/\S+/g) ?? []).length,
    ...extra };
}

export function normalizeSocialBatch(values, family, contexts) {
  const generatedContents = [], generatedContentErrors = [], completedKeys = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i], context = contexts[i];
    const index = context.contentIndex ?? context.tweetIndex ?? 1;
    const completion = family === 'quick' ? `quick-${index}`
      : family === 'carousel' ? context.carouselVariant
        : family.startsWith('heavy-') ? `${family}-${index}`
          : family === 'essay' ? `essay-${index}` : family;
    completedKeys.push(completion);
    if (value.error && !(family === 'essay' && context.essayBody)) { generatedContentErrors.push(socialError(value.error, context, family)); continue; }
    try {
      if (family === 'quick' || family === 'interaction') {
        const posts = socialPosts(value.output);
        for (const [j, post] of posts.entries()) for (const network of socialNetworks) {
          generatedContents.push(makeSocialRecord(context, network,
            family === 'quick' ? 'pensamento-rapido' : 'interacao', network === 'Instagram' ? 'story' : 'post',
            `${family}-${index}-${j + 1}`, [post]));
        }
      } else if (family === 'sequence' || family === 'thread' || family === 'carousel') {
        const parts = socialParts(value.output);
        const type = family === 'sequence' ? 'sequencia-pensamentos' : family;
        const key = family === 'carousel' ? context.carouselVariant : family;
        const media = family === 'sequence' ? null : {
          status: 'briefing', images: 'Imagens não geradas por este fluxo; textos e instruções reunidos no documento.',
          sourceDecision: context.imageDecision ?? null,
          missingFirstPart: family !== 'sequence' && !context.firstPart,
        };
        const fullParts = context.firstPart && family !== 'sequence' ? [context.firstPart, ...parts] : parts;
        for (const network of socialNetworks) {
          const format = family === 'sequence'
            ? { Twitter: 'thread', Instagram: 'sequencia-stories', LinkedIn: 'post' }[network]
            : { Twitter: family === 'carousel' ? 'thread-4-imagens-por-tweet' : 'thread-com-imagens',
              Instagram: 'carrossel', LinkedIn: 'carrossel-pdf' }[network];
          const caption = context.caption ?? '';
          const label = network === 'Twitter' ? 'Tweet' : network === 'Instagram' ? family === 'sequence' ? 'Story' : 'Slide' : 'Página';
          const main = network === 'LinkedIn' && family === 'sequence' ? fullParts.join('\n\n')
            : fullParts.map((part, i) => family === 'carousel' && network === 'Twitter'
              ? `${i % 4 === 0 ? '## Tweet ' + (Math.floor(i / 4) + 1) + '\n\n' : ''}### Imagem ${i % 4 + 1}\n\n${part}`
              : `### ${label} ${i + 1}\n\n${part}`).join('\n\n---\n\n');
          const captionLabel = network === 'Twitter' ? 'Legenda do primeiro tweet' : network === 'LinkedIn' ? 'Texto do post' : 'Legenda';
          const body = caption ? `${main}\n\n## ${captionLabel}\n\n${caption}` : main;
          generatedContents.push(makeSocialRecord(context, network, type, format, key, fullParts,
            { body, caption, captionPlacement: caption ? (network === 'Twitter' ? 'primeiro-tweet' : network === 'LinkedIn' ? 'texto-do-post' : 'legenda') : null, media, carouselVariant: context.carouselVariant ?? null,
              imageGroups: family === 'carousel' && network === 'Twitter'
                ? Array.from({ length: Math.ceil(fullParts.length / 4) }, (_, p) => fullParts.slice(p * 4, p * 4 + 4)) : undefined }));
        }
      } else if (family.startsWith('heavy-')) {
        const network = { 'heavy-twitter': 'Twitter', 'heavy-linkedin': 'LinkedIn', 'heavy-instagram': 'Instagram' }[family];
        const text = socialText(parseSocialOutput(value.output));
        if (!text) throw new Error('Texto adaptado vazio.');
        const limit = network === 'LinkedIn' ? 3000 : network === 'Instagram' ? 2200 : null;
        if (limit && text.length > limit) throw new Error(`Agent retornou ${text.length} caracteres; limite ${limit}. Texto original conservado nas outras redes.`);
        generatedContents.push(makeSocialRecord(context, network, 'text-heavy', network === 'Instagram' ? 'imagem-com-legenda' : 'post-com-imagem',
          `text-heavy-${index}`, [text], { characterCount: text.length, characterLimit: limit,
            media: { status: 'briefing', sourceDecision: context.imageDecision ?? null } }));
      } else if (family === 'essay') {
        const essay = context.essayBody;
        if (!essay) throw new Error('Ensaio vazio.');
        if(value.error)generatedContentErrors.push(socialError(value.error,context,'conclusão'));
        const conclusion = value.error ? '' : socialText(parseSocialOutput(value.output));
        const body = [essay, conclusion].filter(Boolean).join('\n\n');
        const heading = context.headline ?? {};
        for (const network of ['LinkedIn', 'Twitter']) generatedContents.push(makeSocialRecord(context, network,
          'ensaio', 'artigo', `essay-${index}`, [body], { body,
            title: heading.title || context.angle || 'Ensaio', subtitle: heading.subtitle ?? '',
            headlineAnalysis: heading.analysis ?? heading, conclusion }));
      }
      for (const error of context.stageErrors ?? []) generatedContentErrors.push(error);
    } catch (error) { generatedContentErrors.push(socialError(error, context, family)); }
  }
  return { generatedContents, generatedContentErrors, completedKeys: [...new Set(completedKeys)] };
}

export function collectSocialResults(batches, expectedKeys) {
  const completed = new Set(batches.flatMap(batch => batch.completedKeys ?? []));
  if (expectedKeys.some(key => !completed.has(key))) return null;
  const contents = new Map();
  for (const content of batches.flatMap(batch => batch.generatedContents ?? [])) contents.set(content.contentKey, content);
  const errors = new Map();
  for (const error of batches.flatMap(batch => batch.generatedContentErrors ?? [])) errors.set(JSON.stringify(error), error);
  return { generatedContents: [...contents.values()], generatedContentErrors: [...errors.values()] };
}
