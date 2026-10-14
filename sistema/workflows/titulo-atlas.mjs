// O parser e o Code validam títulos não vazios, sem limite de comprimento.
export const atlasTitleSchema = {
  type: 'object', additionalProperties: false, required: ['title'],
  properties: { title: { type: 'string', minLength: 1 } },
};

export function prepareAtlasTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Título de nota ausente ou vazio.');
  const normalized = value.trim().replace(/\s+/g, ' ');
  return { title: normalized };
}

export const atlasTitleInstruction = 'Comprimento do título: busque aproximadamente 130 caracteres, preferencialmente entre 110 e 150. Títulos mais curtos são válidos quando suficientes. O máximo aceito é 170 caracteres. Preserve a ideia central e retorne o título completo, sem reticências para abreviá-lo.';

export const atlasTitleCode = prepareAtlasTitle.toString() + `
const context=$('Validar decisão de conhecimento').item.json;
let originalTitle;
try {
  let output=$input.first().json.output;
  if(typeof output==='string')output=JSON.parse(output);
  originalTitle=output?.title;
  const title=prepareAtlasTitle(output?.title);
  return [{json:{...context,ok:true,block:{...context.block,...title,status:'prepared'}}}];
} catch(error) {
  return [{json:{...context,ok:false,block:{...context.block,...(typeof originalTitle==='string'?{originalTitle}: {})},errorMessage:error.message}}];
}`;

export function fixAtlasTitle(workflow) {
  const w=structuredClone(workflow);
  for(const name of ['Schema — Título da nota','Montar nota preparada']) {
    const n=w.nodes.find(node=>node.name===name);
    if(!n)throw new Error('Node esperado ausente: '+name);
    if(name==='Schema — Título da nota')n.parameters.inputSchema=JSON.stringify(atlasTitleSchema);
    else n.parameters.jsCode=atlasTitleCode;
  }
  const agent=w.nodes.find(n=>n.name==='Agent: Preparador de Notas');
  if(!agent)throw new Error('Agent: Preparador de Notas ausente.');
  if(!agent.parameters.options.systemMessage.includes(atlasTitleInstruction))agent.parameters.options.systemMessage+='\n\n'+atlasTitleInstruction;
  // Títulos completos também precisam ser aceitos na árvore recebida do programa.
  for(const n of w.nodes)if(n.parameters.jsCode?.includes('function validateZettelTree('))
    n.parameters.jsCode=n.parameters.jsCode.replace(/n\.title\.length\s*>\s*(?:150|170)\s*\|\|\s*/g,'');
  return w;
}
