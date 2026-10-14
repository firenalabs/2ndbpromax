export function normalizeEditorial(result) {
  const posts = [], errors = [...(result.erros ?? [])];
  const parse = value => {
    if (typeof value !== 'string') return value;
    const text = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
    try { return JSON.parse(text); } catch { return text; }
  };
  const textOf = v => typeof v === 'string' ? v.trim() : typeof v?.text === 'string' ? v.text.trim() : typeof v?.body === 'string' ? v.body.trim() : '';
  const partsOf = v => { const p = parse(v); const parts = Array.isArray(p) ? p : p?.parts ?? p?.slides ?? (typeof p === 'string' ? p.split(/^\s*---\s*$/m) : [p]); return Array.isArray(parts) ? parts.map(textOf).filter(Boolean) : []; };
  const add = (key, type, networks, parts, extra = {}) => {
    if (!parts.length) { errors.push({ node: key, erro: { message: 'Conteúdo final vazio.' } }); return; }
    for (const [platform, format] of Object.entries(networks)) {
      const body = platform === 'LinkedIn' && type === 'sequencia' ? parts.join('\n\n') : parts.map((p, i) => parts.length > 1 ? `### Parte ${i + 1}\n\n${p}` : p).join('\n\n---\n\n');
      posts.push({ contentKey: key + ':' + platform, baseContentKey: key, platform, format, contentType: type, parts,
        title: extra.title || parts[0].split('\n')[0].replace(/^#+\s*/, '').slice(0, 150), body,
        ...extra });
    }
  };
  const shortNetworks = { Twitter: 'single_text', LinkedIn: 'single_text', Instagram: 'stories' };
  for (const item of result.outputsDosAgents ?? []) {
    if (item.erro) continue;
    if (!['Tweets/Stories sem angulo', 'Interação com seguidores', 'Sequência de pensamentos rápidos'].includes(item.agent)) continue;
    const key = `${item.agent}:${item.run}:${item.item}`;
    const output = parse(item.output);
    if (item.agent === 'Sequência de pensamentos rápidos') add(key, 'sequencia', { Twitter: 'thread', LinkedIn: 'single_text', Instagram: 'stories' }, partsOf(output));
    else for (const [i, post] of (Array.isArray(output) ? output : output?.posts ?? [output]).entries()) add(key + ':' + i,
      item.agent === 'Interação com seguidores' ? 'interacao' : 'pensamento-rapido', shortNetworks, [textOf(post)].filter(Boolean));
    if (!posts.some(p=>p.contentKey.startsWith(key))) errors.push({node:item.agent,erro:{message:'Agent retornou saída sem texto utilizável.'}});
  }
  for (const item of result.resultadosFinais ?? []) {
    const v = item.resultado ?? {}, key = `${item.node}:${item.run}:${item.item}`;
    if (item.node.startsWith('Reunir carrossel e legenda')) {
      if (v.error) continue;
      const parts = partsOf(v.partsOutput ?? v.output);
      add(key, item.node.endsWith('1') ? 'storytelling' : 'utilidade', { Twitter: 'carousel', LinkedIn: 'carousel', Instagram: 'carousel' }, parts,
        { caption: v.caption ?? '', variant: v.carouselVariant ?? null, mediaPending: true, twitterImagesPerTweet: 4, linkedinPdfPending: true });
    } else if (item.node === 'Organizar thread completa por rede1') {
      for (const c of v.generatedContents ?? []) add(key, 'resumo', { [c.socialNetwork]: c.socialNetwork === 'Twitter' ? 'thread' : 'carousel' }, c.parts ?? [], { mediaPending: true, imageDecisions: c.media?.sourceDecision ?? null });
    } else if (item.node.startsWith('Conservar decisão — imagem-post')) {
      if (!v.error && v.baseText) add(key, item.node.endsWith('1') ? 'opiniao' : 'educativo', { Twitter: 'single_text', LinkedIn: 'single_text', Instagram: 'single_text' }, [v.baseText], { mediaPending: true, imageDecisions: v.imageDecision });
    } else if (/^(Adaptar text-heavy|Conservar texto) — (LinkedIn|Instagram)/.test(item.node)) {
      if (v.error) continue;
      const network = item.node.includes('LinkedIn') ? 'LinkedIn' : 'Instagram';
      const text = textOf(parse(v.output));
      add(key, item.node.endsWith('1') ? 'opiniao' : 'educativo', { [network]: 'single_text' }, [text].filter(Boolean), { mediaPending: true });
    } else if (item.node.startsWith('Conservar título e ensaio para conclusão')) {
      if (!v.essayBody) continue;
      const heading = parse(v.headline) ?? {};
      add(key, 'ensaio', { Twitter: 'article', LinkedIn: 'article', Blog: 'article' }, [v.essayBody], { title: heading.title, subtitle: heading.subtitle ?? '' });
      const suffix = item.node.endsWith('1') ? '1' : '';
      const cta = (result.outputsDosAgents ?? []).find(a => a.agent === 'SOFT CTA PARA O PROPRIO TEXTO' + suffix && a.run === item.run && a.item === item.item);
      if (cta && !cta.erro) add(key + ':chamada', 'chamada-ensaio', { Instagram: 'thumbnail' }, [textOf(parse(cta.output))].filter(Boolean), { articleContentKey: key, mediaPending: true });
    }
  }
  return { posts, errors };
}

export function validEditorialCheckpoint(name, values) {
  const parse = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')); } catch { return value; } };
  const text = value => typeof value === 'string' ? value.trim() : typeof value?.text === 'string' ? value.text.trim() : typeof value?.body === 'string' ? value.body.trim() : '';
  return Array.isArray(values) && values.length > 0 && values.every(v => {
    if (v.error) return false;
    if (name.startsWith('Jev')) return v.answers && Object.values(v.answers).length && Object.values(v.answers).every(a => a.type === 'noul' && Number.isFinite(a.noul) && a.noul >= 0 && a.noul <= 1);
    const o = parse(v.output);
    if (name.startsWith('título')) return typeof o?.title === 'string' && !!o.title.trim();
    if (/carrossel|thread|Sequência/.test(name)) {
      const parts = o?.parts ?? o?.slides ?? (typeof o === 'string' ? o.split(/^\s*---\s*$/m) : null);
      return Array.isArray(parts) && parts.length > 0 && parts.every(p => !!text(p));
    }
    if (/Tweets\/Stories|Interação/.test(name)) return Array.isArray(o?.posts) && o.posts.length > 0 && o.posts.every(p => !!text(p));
    if (name.startsWith('Angulos')) return typeof o === 'string' && !!o.trim() || Array.isArray(o) && o.length > 0 || Array.isArray(o?.angles) && o.angles.length > 0;
    return !!text(o);
  });
}
