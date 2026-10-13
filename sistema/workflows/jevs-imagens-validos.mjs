// Serializa o mesmo corpo, sem mudar perguntas, critérios, modelo ou texto avaliado.
export function fixImageJevBodies(workflow) {
  const w=structuredClone(workflow);
  for(const n of w.nodes) {
    if(n.type!=='n8n-nodes-base.httpRequest' || !/^Jev — CABE google imagens\? \(para cada tweet\)[12]?(?: — chamada)?$/.test(n.name))continue;
    const body=n.parameters.jsonBody;
    if(body.startsWith('={{ JSON.stringify('))continue;
    if(!body.startsWith('={{') || !body.endsWith('}}'))throw new Error('Expressão Jev inesperada: '+n.name);
    const expression=body.slice(3,-2).trim();
    const match=expression.match(/^\{\s*"model"\s*:\s*"([^"]+)"\s*,\s*state\s*:\s*\{\s*text\s*:\s*(\$json\.part\s*\?\?\s*\$json\.baseText\s*\?\?\s*\$json\.text\s*\?\?\s*\$json\.texto)\s*\}\s*,\s*questions\s*:\s*(\{[\s\S]*\})\s*\}$/);
    if(!match)throw new Error('Corpo Jev mudou; revisar antes de serializar: '+n.name);
    const questions=JSON.parse(match[3]);
    n.parameters.jsonBody=`={{ JSON.stringify({\n  model: ${JSON.stringify(match[1])},\n  state: { text: (${match[2]}) },\n  questions: ${JSON.stringify(questions,null,2)}\n}) }}`;
  }
  return w;
}
