import {normalizeEditorial,validEditorialCheckpoint} from '../outputs-editoriais.mjs';
import {centralizePosts,normalizeCentralEditorial} from '../conteudo-centralizado.mjs';

export const networkAdaptationNodes=[...['','1'].flatMap(suffix=>['LinkedIn','Instagram'].flatMap(network=>{
  const name='Adaptar text-heavy — '+network+suffix;
  return [name,name+' — chamada','Conferir cache — '+name,'Retomar resultado — '+name,
    'Conservar texto — '+network+suffix,'Text-heavy excede '+(network==='LinkedIn'?3000:2200)+' caracteres — '+network+'?'+suffix];
}))];

export function withoutNetworkAdaptations(workflow) {
  const w=structuredClone(workflow),removed=new Set(networkAdaptationNodes);
  for(const name of networkAdaptationNodes)delete w.connections[name];
  for(const channels of Object.values(w.connections))for(const batches of Object.values(channels))for(let i=0;i<batches.length;i++)batches[i]=batches[i].filter(e=>!removed.has(e.node));
  w.nodes=w.nodes.filter(n=>!removed.has(n.name));
  for(const n of w.nodes.filter(n=>n.type.endsWith('.stickyNote')))if(n.parameters.content?.includes('SE O TEXTO TIVER MUITOS CARACTERES, É ADAPTADO'))
    n.parameters.content=n.parameters.content.replaceAll('SE O TEXTO TIVER MUITOS CARACTERES, É ADAPTADO','TEXTO-BASE INTEGRAL, SEM ADAPTAÇÃO POR LIMITE NESTA ETAPA');
  const collector=w.nodes.find(n=>n.name==='Ver todos os outputs dos Agents');
  let code=collector.parameters.jsCode;
  for(const name of ['names','agentNames','resultadosFinais']) {
    const match=code.match(new RegExp('const '+name+'=(\\[.*?\\])'));
    if(!match)throw new Error('Inventário do coletor mudou: '+name);
    code=code.replace(match[0],'const '+name+'='+JSON.stringify(JSON.parse(match[1]).filter(n=>!removed.has(n))));
  }
  const graph=Object.entries(w.connections).flatMap(([source,channels])=>(channels.main??[]).flatMap((batch,output)=>batch.map(e=>({source,target:e.node,output}))))
    .filter(e=>!['Ver todos os outputs dos Agents','Retornar comparação editorial'].includes(e.target)&&!['Ver todos os outputs dos Agents','Organizar posts e checkpoints'].includes(e.source));
  code=code.replace(/const graph=\[.*?\];/,'const graph='+JSON.stringify(graph)+';');
  collector.parameters.jsCode=code;
  const final=w.nodes.find(n=>n.name==='Organizar posts e checkpoints');
  const match=final.parameters.jsCode.match(/for\(const name of (\[.*?\])\)/);
  if(!match)throw new Error('Lista de checkpoints mudou.');
  const stages=JSON.parse(match[1]).filter(n=>!removed.has(n));
  final.parameters.jsCode=[normalizeEditorial,centralizePosts,normalizeCentralEditorial,validEditorialCheckpoint].map(fn=>fn.toString()).join('\n')+`
const result=$input.first().json;const normalized=normalizeCentralEditorial(result);const cache={};
for(const name of ${JSON.stringify(stages)}){if(!$(name).isExecuted)continue;cache[name]=[];for(let run=0;run<256;run++){try{const values=$(name).all(0,run).map(i=>i.json);cache[name][run]=validEditorialCheckpoint(name,values)&&!normalized.errors.some(e=>e.node===name)?values:null;}catch{break;}}}
for(const name of Object.keys(cache))cache[name]=Object.fromEntries(cache[name].flatMap((v,i)=>v?[[i,v]]:[]));
return [{json:{ok:true,contentSchemaVersion:1,...normalized,cache,workflowId:$workflow.id,executionId:$execution.id,diagnostics:result}}];`;
  for(const n of w.nodes)for(const m of JSON.stringify(n.parameters).matchAll(/\$\(['"]([^'"]+)['"]\)/g))if(removed.has(m[1]))throw new Error('Referência removida ainda presente: '+n.name);
  return w;
}
