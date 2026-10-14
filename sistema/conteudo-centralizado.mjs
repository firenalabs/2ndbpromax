import {normalizeEditorial} from './outputs-editoriais.mjs';

// Identidade editorial vem da etapa/run/item/post, nunca da semelhança do texto.
export function centralizePosts(posts) {
  const contents=[], warnings=[];
  const platforms=new Set(['Twitter','LinkedIn','Instagram','Blog']);
  for(const post of posts) {
    if(!platforms.has(post.platform)||!post.contentKey||typeof post.body!=='string'||!post.body.trim())throw new Error('Post sem rede, identidade ou texto válido.');
    const parts=Array.isArray(post.parts)&&post.parts.length?post.parts:[post.body];
    if(parts.some(p=>typeof p!=='string'||!p.trim()))throw new Error('Blocos textuais inválidos.');
    let key=post.baseContentKey??post.contentKey.replace(/(?::(?:Twitter|LinkedIn|Instagram|Blog))+$/,'');
    // Só relaciona os antigos terminais de adaptação às suas etapas-base conhecidas.
    key=key.replace(/^(?:Adaptar text-heavy|Conservar texto) — (?:LinkedIn|Instagram)(1?):/,(_,suffix)=>'Conservar decisão — imagem-post'+suffix+':');
    const content={contentKey:key,contentType:post.contentType,title:post.title??'',subtitle:post.subtitle??'',parts:[...parts],caption:post.caption??'',
      variant:post.variant??null,articleContentKey:post.articleContentKey??null};
    const signature=v=>JSON.stringify([v.title,v.subtitle,v.parts,v.caption,v.variant]);
    const siblings=contents.filter(c=>c.baseContentKey===key&&c.contentType===post.contentType);
    let target=siblings.find(c=>signature(c)===signature(content));
    if(!target) {
      if(siblings.length){content.contentKey=key+':variante-'+(siblings.length+1);content.legacyTextVariant=true;warnings.push({contentKey:key,message:'Saída antiga possui texto diferente por rede; preservada como variante, sem sobrescrever.'});}
      target={...content,baseContentKey:key,destinations:[],mediaPending:!!post.mediaPending};contents.push(target);
    }
    const destination={platform:post.platform,format:post.platform==='Twitter'&&post.format==='carousel'?'thread':post.format,
      ...(post.platform==='LinkedIn'&&post.format==='carousel'?{renderTarget:'pdf'}:{}),
      ...(post.caption?{captionPlacement:post.platform==='Twitter'?'first_tweet':post.platform==='LinkedIn'?'post_text':'caption'}:{}),
      ...(post.imageDecisions!==undefined?{imageDecisions:post.imageDecisions}:{}),
      ...(post.twitterImagesPerTweet?{imagesPerTweet:post.twitterImagesPerTweet}:{}),
      ...(post.linkedinPdfPending?{pdfPending:true}:{})};
    if(!target.destinations.some(d=>d.platform===destination.platform&&d.format===destination.format))target.destinations.push(destination);
    target.mediaPending ||= !!post.mediaPending;
  }
  return {contents,warnings};
}

export function normalizeCentralEditorial(result) {
  const isAdaptation=name=>/^(?:Adaptar text-heavy|Conservar texto) — (?:LinkedIn|Instagram)/.test(name??'');
  const normalized=normalizeEditorial({...result,
    resultadosFinais:(result.resultadosFinais??[]).filter(item=>!isAdaptation(item.node)),
    erros:(result.erros??[]).filter(item=>!isAdaptation(item.node))});
  const central=centralizePosts(normalized.posts);
  return {...central,errors:normalized.errors};
}
