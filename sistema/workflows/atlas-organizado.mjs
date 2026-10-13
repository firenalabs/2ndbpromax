// Alterações de apresentação e limpeza; as decisões e chamadas permanecem iguais.
function trimHelpers(code, marker) {
  const end = code.indexOf(marker);
  if (end < 0 || !code.startsWith('function letterAddress(')) throw new Error('Estrutura do Code do Atlas mudou.');
  const matches = [...code.slice(0,end).matchAll(/^function (\w+)\(/gm)];
  const helpers = new Map(matches.map((m,i)=>[m[1],code.slice(m.index,matches[i+1]?.index??end)]));
  const body=code.slice(end), retained=new Set();
  function visit(text) {
    for (const [name, helper] of helpers) if (!retained.has(name) && new RegExp('\\b'+name+'\\b').test(text)) {
      retained.add(name); visit(helper);
    }
  }
  visit(body);
  return [...helpers].filter(([name])=>retained.has(name)).map(([,helper])=>helper).join('')+body;
}

export function organizeAtlas(workflow) {
  const w=structuredClone(workflow);
  if (!w.nodes.some(n=>n.name==='Cortar texto deterministicamente')) return w;
  const find=name=>{const n=w.nodes.find(n=>n.name===name);if(!n)throw new Error('Node esperado ausente: '+name);return n;};
  const old='Cortar texto deterministicamente', next='Preparar recortes recebidos';
  const adapter='Preparar categoria raiz';
  if(find(adapter).parameters.jsCode!=='return [{json:$input.first().json}];')throw new Error('Preparação da categoria mudou; revisar antes de remover.');
  // O Code atual apenas transforma a lista de recortes já recebidos em itens.
  find(old).name=next;
  w.connections[next]=w.connections[old];delete w.connections[old];
  for(const channels of Object.values(w.connections))for(const batches of Object.values(channels))for(const batch of batches)for(const e of batch)if(e.node===old)e.node=next;
  // O contexto da nova categoria passa a vir diretamente da condição anterior.
  w.connections['Criar categoria raiz?'].main[0]=[{node:'Agent: Criador de Categorias',type:'main',index:0}];
  delete w.connections[adapter];w.nodes=w.nodes.filter(n=>n.name!==adapter);
  const create=find('Validar categoria raiz e posicionar nota');
  create.parameters.jsCode=create.parameters.jsCode.replace("$('Preparar categoria raiz')", "$('Criar categoria raiz?')");
  for(const[name,marker]of [
    ['Validar pedido do Atlas','\ntry {\nconst input='],
    ['Validar categoria raiz e posicionar nota','\nconst context=$('],
    ['Avançar ou posicionar nota','\nconst input=$input.'],
  ])find(name).parameters.jsCode=trimHelpers(find(name).parameters.jsCode,marker);
  const positions={
    'Receber pedido do Atlas':[0,0], 'Validar pedido do Atlas':[256,0], 'Pedido válido?':[512,0],
    'Preparar recortes recebidos':[768,0], 'Processar cada recorte':[1024,0],
    'Retornar resultado ao computador1':[512,384],
    'Preparar julgamento de conhecimento':[1408,0], 'Jev — Tem conhecimento?':[1672,0],
    'Validar decisão de conhecimento':[1936,0], 'Conhecimento aceito?':[2200,0],
    'Agent: Preparador de Notas':[2464,0], 'OpenRouter — Atlas':[2480,208],
    'Schema — Título da nota':[2656,208], 'Montar nota preparada':[2816,0],
    'Nota preparada válida?':[3080,0], 'Preparar julgamento de posição':[1408,896],
    'Há opções neste nível?':[1672,896], 'Jev — Categoria ou nota mais adequada':[1936,896],
    'Validar escolha de posição':[2200,896], 'Criar categoria raiz?':[2464,896],
    'Avançar ou posicionar nota':[2736,896], 'Nota posicionada?':[3000,896],
    'Agent: Criador de Categorias':[2736,1280], 'OpenRouter — Atlas1':[2752,1488],
    'Schema — Nova categoria':[2928,1488], 'Validar categoria raiz e posicionar nota':[3104,1280],
    'Concluir recorte e atualizar Atlas':[3536,896], 'Montar resultado completo do Atlas':[3792,1280],
    'Retornar resultado ao computador':[4304,1280],
  };
  for(const[name,position]of Object.entries(positions))find(name).position=position;
  const guides={
    'Guia — Entrada e conclusão':{position:[-128,-288],width:1344,height:896,color:5,
      content:'## 1. Receber e validar os recortes\n\nO workflow 01 já fez os cortes por KeyTopics. Aqui, cada recorte recebido vira um item.\n\n**Processar cada recorte:** trata um de cada vez, usando o Atlas atualizado pelo anterior.\n\n• loop → avaliar o próximo recorte.\n• done → montar o resultado completo, na etapa 4.\n\nPedido inválido → resposta de erro.'},
    'Guia — Conhecimento e notas':{position:[1296,-288],width:1984,height:864,color:4,
      content:'## 2. Avaliar conhecimento e preparar a nota\n\nSomente recortes com conhecimento aceito entram no Atlas.\n\nJev aceito → Preparador de Notas → validar título → etapa 3.\n\nSem conhecimento ou com erro → concluir recorte na etapa 4. O resultado filtrado ou o erro é preservado.'},
    'Guia — Selecionar ou criar categorias':{position:[1296,640],width:2080,height:1152,color:3,
      content:'## 3. Escolher categoria e posição da nota\n\n**Linha superior:** avaliar as opções do nível atual. Começa nas categorias raiz e pode descer pelos títulos das notas.\n\n• Nota posicionada = false → analisar o próximo nível.\n• Sem nota adequada neste nível → inserir como próxima irmã.\n\n**Linha inferior:** criar categoria quando nenhuma raiz é adequada; validar a categoria e posicionar a nota. Categorias novas são criadas somente na raiz.'},
    'Guia — Próximo recorte':{position:[3392,-288],width:1280,height:2080,color:7,
      content:'## 4. Atualizar o Atlas e devolver o resultado\n\n**Concluir recorte:** recebe todos os caminhos, conserva a árvore atualizada e volta ao loop da etapa 1. Ainda não responde ao computador.\n\n**Montar resultado completo:** recebe a saída done do loop, depois de todos os recortes.\n\nRetorna recortes, novas categorias, novas notas e erros. O programa local salva os arquivos do Atlas.'},
  };
  for(const[name,guide]of Object.entries(guides)){
    const n=find(name);n.position=guide.position;for(const key of ['width','height','color','content'])n.parameters[key]=guide[key];
  }
  for(const n of w.nodes)if(JSON.stringify(n.parameters).includes(adapter))throw new Error('Referência ao adaptador ainda presente: '+n.name);
  return w;
}
