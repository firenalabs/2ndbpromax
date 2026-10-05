export const aspectKeys = ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife'];
export const aspectLabels = { victory: 'Vitória', obstacle: 'Obstáculo', story: 'História', gratitude: 'Gratidão', joke: 'Piada', personalLife: 'Vida pessoal' };

export function prepareAspectActions(context) {
  const keys = ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife'];
  if (keys.some(key => typeof context?.aspects?.flags?.[key] !== 'boolean')) throw new Error('Aspectos inválidos para roteamento.');
  const active = keys.filter(key => context.aspects.flags[key]);
  return (active.length ? active : ['none']).map(aspect => ({ ...context, flags: context.aspects.flags, aspect }));
}

export function combineFinalization(items) {
  if (!items.length || !items[0].aspects) throw new Error('Finalização sem resultados de aspectos.');
  const first = items[0];
  const errors = Object.assign({}, ...items.map(item => item.errors ?? {}));
  const victory = items.find(item => item.aspect === 'victory');
  return { ok: true, aspects: first.aspects, diary: first.diary ?? null,
    achievements: victory?.achievements ?? [], errors,
    activeRoutes: Object.keys(first.aspects.flags).filter(key => first.aspects.flags[key]),
    actionResults: items.filter(item => item.aspect !== 'none').map(item => ({ aspect: item.aspect, status: item.errors?.brag && item.aspect === 'victory' ? 'failed' : item.aspect === 'victory' ? 'completed' : 'no_behavior' })) };
}

export function readNoul(response, key, threshold) {
  const answer = response?.answers?.[key];
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Limiar Jev inválido.');
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error(`Jev não retornou uma probabilidade válida para ${key}.`);
  return { probability: answer.noul, threshold, accepted: answer.noul >= threshold, model: 'typesafe/jev-1.13', evaluatedAt: new Date().toISOString() };
}

export function readAspects(response, threshold) {
  const decisions = {};
  const flags = {};
  for (const key of ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife']) {
    decisions[key] = readNoul(response, key, threshold);
    flags[key] = decisions[key].accepted;
  }
  return { flags, decisions };
}

export function combineAspectResponses(responses, threshold) {
  const keys = ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife'];
  const answers = {};
  for (const key of keys) answers[key] = responses?.[key]?.answers?.[key];
  const aspects = readAspects({ answers }, threshold);
  return { aspects, activeRoutes: keys.filter(key => aspects.flags[key]) };
}

export function validateDecision(decision, threshold) {
  if (!decision || decision.threshold !== threshold || !Number.isFinite(decision.probability) || decision.probability < 0 || decision.probability > 1
    || decision.accepted !== (decision.probability >= threshold)) throw new Error('Decisão Jev inválida.');
  return decision;
}

export function validateAspects(value, threshold) {
  for (const key of ['victory', 'obstacle', 'story', 'gratitude', 'joke', 'personalLife']) {
    const decision = validateDecision(value?.decisions?.[key], threshold);
    if (value?.flags?.[key] !== decision.accepted) throw new Error(`Aspecto inválido: ${key}.`);
  }
  return value;
}

export function validateDiaryOutput(value) {
  if (typeof value?.title !== 'string' || !value.title.trim() || value.title.length > 150
    || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 2000) throw new Error('O Escrivão do Diário não retornou título e resumo válidos.');
  return { title: value.title.trim(), summary: value.summary.trim() };
}

export function validateBragOutput(value, fullText) {
  if (!Array.isArray(value?.achievements) || value.achievements.length > 20) throw new Error('O Escrivão Brag Document não retornou uma lista válida.');
  return value.achievements.map(item => {
    if (typeof item?.evento !== 'string' || !item.evento.trim() || item.evento.length > 150
      || typeof item.descricao !== 'string' || !item.descricao.trim() || item.descricao.length > 2000
      || !['entrega', 'vitória pessoal', 'aprendizado', 'reconhecimento', 'construção'].includes(item.categoria)
      || typeof item.integra !== 'string' || !item.integra.trim() || !fullText.includes(item.integra)) throw new Error('Conquista inválida ou trecho que não é literal do original.');
    return { evento: item.evento.trim(), descricao: item.descricao.trim(), categoria: item.categoria, integra: item.integra };
  });
}
