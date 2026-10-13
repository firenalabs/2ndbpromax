// O parser verifica a estrutura; o Code aplica o limite de armazenamento.
export const atlasTitleSchema = {
  type: 'object', additionalProperties: false, required: ['title'],
  properties: { title: { type: 'string', minLength: 1 } },
};

export function prepareAtlasTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Título de nota ausente ou vazio.');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 150) return { title: normalized };
  // Array.from evita dividir um par de substitutos (por exemplo, um emoji).
  let prefix = '';
  for (const character of normalized) {
    if (prefix.length + character.length > 149) break;
    prefix += character;
  }
  const boundary = prefix.lastIndexOf(' ');
  if (boundary > 0) prefix = prefix.slice(0, boundary);
  return { title: prefix.trimEnd() + '…', originalTitle: value };
}

export const atlasTitleCode = prepareAtlasTitle.toString() + `
const context=$('Validar decisão de conhecimento').item.json;
try {
  let output=$input.first().json.output;
  if(typeof output==='string')output=JSON.parse(output);
  const title=prepareAtlasTitle(output?.title);
  return [{json:{...context,ok:true,block:{...context.block,...title,status:'prepared'}}}];
} catch(error) {
  return [{json:{...context,ok:false,errorMessage:error.message}}];
}`;

export function fixAtlasTitle(workflow) {
  const w=structuredClone(workflow);
  for(const name of ['Schema — Título da nota','Montar nota preparada']) {
    const n=w.nodes.find(node=>node.name===name);
    if(!n)throw new Error('Node esperado ausente: '+name);
    if(name==='Schema — Título da nota')n.parameters.inputSchema=JSON.stringify(atlasTitleSchema);
    else n.parameters.jsCode=atlasTitleCode;
  }
  return w;
}
