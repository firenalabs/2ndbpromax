export function validateSegmentSource(text, segmentedText, segmentation) {
  if (typeof text !== 'string' || !text.trim() || segmentation?.offsetUnit !== 'utf16'
    || !Array.isArray(segmentation.segments) || !segmentation.segments.length) throw new Error('Texto ou mapa de segmentos inválido.');
  let lastEnd=0;
  for (const [i,s] of segmentation.segments.entries()) {
    if (s?.id !== `SEG_${String(i+1).padStart(5,'0')}` || !Number.isInteger(s.start) || !Number.isInteger(s.end)
      || s.start<lastEnd || s.end<=s.start || s.end>text.length
      || text.slice(lastEnd,s.start).trim() || !text.slice(s.start,s.end).trim()) throw new Error('Segmento inválido: '+(s?.id??i));
    lastEnd=s.end;
  }
  if (text.slice(lastEnd).trim()) throw new Error('Mapa de segmentos perdeu conteúdo do original.');
  const expected=segmentation.segments.map(s=>`[${s.id}] ${text.slice(s.start,s.end).trim()}`).join('\n');
  if (segmentedText!==expected) throw new Error('Texto segmentado diverge do original e do mapa.');
  return segmentation;
}

export function extractSegmentAchievements(value, context) {
  validateSegmentSource(context.text,context.segmentedText,context.segmentation);
  if (!Array.isArray(value?.achievements) || value.achievements.length>20) throw new Error('O Escrivão Brag Document não retornou uma lista válida.');
  const segments=context.segmentation.segments;
  return value.achievements.map((item,index)=>{
    if (typeof item?.evento!=='string' || !item.evento.trim() || item.evento.length>150
      || typeof item.descricao!=='string' || !item.descricao.trim() || item.descricao.length>2000
      || !['entrega','vitória pessoal','aprendizado','reconhecimento','construção'].includes(item.categoria)) throw new Error('Conquista '+(index+1)+' inválida.');
    const first=segments.findIndex(s=>s.id===item.segmentoInicial), last=segments.findIndex(s=>s.id===item.segmentoFinal);
    if (first<0 || last<first) throw new Error('Intervalo de segmentos inválido na conquista '+(index+1)+'.');
    const start=segments[first].start,end=segments[last].end;
    return {evento:item.evento.trim(),descricao:item.descricao.trim(),categoria:item.categoria,
      integra:context.text.slice(start,end),segmentoInicial:item.segmentoInicial,segmentoFinal:item.segmentoFinal,
      start,end,offsetUnit:'utf16'};
  });
}
