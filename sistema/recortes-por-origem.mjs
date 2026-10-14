export function cutOrigin(source) {
  const sourceId=source.sourceId??source.sourceIds?.[0],digestId=source.digestId??source.digestIds?.[0];
  if(source.kind!=='recorte'||!sourceId||!digestId||source.sourceIds?.length!==1||source.digestIds?.length!==1||source.sourceIds[0]!==sourceId||source.digestIds[0]!==digestId)throw new Error('Recorte sem uma única origem e digestão identificáveis.');
  return {sourceId,digestId,inputName:source.inputName??source.inputFiles?.[0]?.split(/[\\/]/).at(-1)??'insumo-'+sourceId};
}

export function cutsByOrigin(sources) {
  const groups=new Map();
  for(const source of sources) {
    const origin=cutOrigin(source),key=JSON.stringify([origin.sourceId,origin.digestId]);
    if(!groups.has(key))groups.set(key,{origin,sources:[]});
    groups.get(key).sources.push(source);
  }
  return [...groups.values()];
}

export function assertSingleCutOrigin(sources) {
  const groups=cutsByOrigin(sources);
  if(groups.length!==1)throw new Error('Um pedido de recortes deve pertencer a um único insumo original e à mesma digestão.');
  return groups[0].origin;
}
