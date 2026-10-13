import {segmentText} from '../contratos.mjs';
import {validateSegmentSource,extractSegmentAchievements} from '../brag-segmentos.mjs';

export function bragBySegments(workflow) {
  const w=structuredClone(workflow);
  const find=name=>{const n=w.nodes.find(n=>n.name===name);if(!n)throw new Error('Node esperado ausente: '+name);return n;};
  const agent=find('Agent: Escrivão Brag Document');
  if(agent.parameters.text==='={{ $json.segmentedText }}')return w;
  const prompt=agent.parameters.options.systemMessage;
  const oldReturn='Retorne somente {"achievements":[{"evento":"...","descricao":"...","categoria":"entrega","integra":"trecho literal"}]}.';
  const oldLiteral='integra deve ser uma substring EXATA do texto recebido, conservando acentos, pontuação e espaços. Escolha um trecho curto e contínuo que fundamente a conquista. Nunca reescreva o trecho ou una frases não consecutivas.';
  if(!prompt.includes(oldReturn)||!prompt.includes(oldLiteral))throw new Error('Formato do prompt Brag mudou; revisar antes de alterar.');
  agent.parameters.text='={{ $json.segmentedText }}';
  agent.parameters.options.systemMessage=prompt
    .replace('a transcrição completa','a transcrição completa segmentada, com IDs SEG_')
    .replace('categoria e integra.','categoria, segmentoInicial e segmentoFinal.')
    .replace(oldLiteral,'Selecione um intervalo curto e contínuo de segmentos que fundamente a conquista. Retorne segmentoInicial e segmentoFinal usando exatamente os IDs presentes no texto recebido. O segmento final é inclusivo. Para um único segmento, repita o mesmo ID nos dois campos. Não copie nem reescreva o trecho: o código extrairá integra diretamente do original. Nunca una segmentos não consecutivos nem invente IDs.')
    .replace(oldReturn,'Retorne somente {"achievements":[{"evento":"...","descricao":"...","categoria":"entrega","segmentoInicial":"SEG_00001","segmentoFinal":"SEG_00002"}]}.' );
  const schema=JSON.parse(find('Schema — Brag Document').parameters.inputSchema);
  const item=schema.properties.achievements.items;
  item.required=item.required.filter(k=>k!=='integra').concat(['segmentoInicial','segmentoFinal']);
  delete item.properties.integra;
  for(const key of ['segmentoInicial','segmentoFinal'])item.properties[key]={type:'string',pattern:'^SEG_[0-9]{5,}$'};
  find('Schema — Brag Document').parameters.inputSchema=JSON.stringify(schema);
  const validator=find('Validar pedido do Diário');
  const marker='return [{json:{...input,ok:true}}];';
  if(!validator.parameters.jsCode.includes(marker))throw new Error('Validação do pedido mudou.');
  // Clientes novos enviam o mapa guardado no 01. Clientes antigos continuam operando
  // durante a atualização, usando a mesma segmentação determinística, sem IA.
  validator.parameters.jsCode=segmentText.toString()+'\n'+validateSegmentSource.toString()+'\n'+validator.parameters.jsCode.replace(marker,`if(input.operation==='finalize') {
  if(input.segmentation===undefined && input.segmentedText===undefined) {
    input.segmentation=segmentText(input.text);
    input.segmentedText=input.segmentation.segments.map(s=>'['+s.id+'] '+input.text.slice(s.start,s.end).trim()).join('\\n');
  }
  validateSegmentSource(input.text,input.segmentedText,input.segmentation);
}
${marker}`);
  find('Validar conquistas e trecho literal').parameters.jsCode=validateSegmentSource.toString()+'\n'+extractSegmentAchievements.toString()+`\nconst context=$('Validar título e resumo').first().json;
try {
  let value=$input.first().json.output;if(typeof value==='string')value=JSON.parse(value);
  return [{json:{...context,aspect:'victory',achievements:extractSegmentAchievements(value,context)}}];
} catch(error) {return [{json:{...context,aspect:'victory',errors:{...context.errors,brag:error.message}}}];}`;
  return w;
}
