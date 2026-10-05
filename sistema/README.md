# Sistema

Esta pasta reúne o código e os arquivos técnicos do protótipo. Para usar, basta abrir `iniciar.bat` no Windows ou `iniciar.sh` no Linux/macOS e colocar textos em **Entrada**.

- `configuracao.json`: endereços e IDs dos workflows novos, modelo, limiar Jev (0,8) e opções de execução.
- `estado.json`: andamento dos arquivos; criado automaticamente. Não apague para tentar novamente.
- `diario.json`: grupos, textos reunidos e janela aberta do Diário; conserva o agrupamento entre reinícios. Não apague para tentar novamente.
- `executor.lock`: impede abrir dois executores ao mesmo tempo; removido ao sair normalmente.
- `atlas.mjs`, `contratos-atlas.mjs` e `zettelkasten.mjs`: persistência do Atlas, cortes e validação dos retornos.
- `diario.mjs` e `contratos-diario.mjs`: agrupamento, persistência, validação dos aspectos e conferência do trecho literal das conquistas.
- `workflows/`: código dos workflows e prompts dos Agents. Não contém chaves de API.
- `testes/`: verificações locais com textos de exemplo, sem chamadas reais a LLM.

Não é necessário `npm install`. Para verificar o código: `npm test` na raiz. Para regenerar as definições locais: `npm run gerar-workflow`, `npm run gerar-workflow-atlas` e `npm run gerar-workflow-diario`. Esses comandos não modificam o n8n.

O workflow do Atlas recebe apenas `process`: `{ atlasSchemaVersion: 2, digest, blocks, categories, notes, knowledgeThreshold }`. O executor gera e salva todos os cortes determinísticos antes da única chamada ao n8n. O workflow confere os cortes e percorre os pendentes em sequência: Jev conhecimento → título → escolha de categoria raiz → títulos de notas por níveis → inserção sequencial da nota. Cada recorte usa a árvore atualizada pelo anterior, dentro da mesma execução. O retorno `{ ok, blocks, newCategories, newNotes, errors }` reúne todos os resultados. O programa valida e salva categorias, recortes e notas; uma nova tentativa envia somente recortes pendentes. Os HTTP Requests Jev e AI Agents continuam separados para customização.

Na finalização de um grupo, o programa chama somente 02b. O 03 é acionado pela opção 8 do menu (`--gerar-conteudos`) para grupos fechados ainda pendentes, com o mesmo payload `{operation: "finalize", text, threshold, groupId, sourceIds}`. O 03 tem webhook próprio `segundo-cerebro-local-conteudos-v1`, conta palavras e usa um dos três Agents. Eles conservam o modelo/parser compartilhados do workflow do usuário. O Code Estruturar conteúdo gerado valida `{title, body}` e acrescenta faixa, formato e contagens. Até 150 palavras, o programa dispensa a chamada de conteúdo. O 03 retorna `{ok, groupId, sourceIds, total_palavras, generatedContent, errors}`; não passa pelos Jevs/Diário.

`conteudos.mjs` centraliza os contratos e deriva o novo endereço do webhook do Diário, preservando domínio/prefixo; `contentWebhook` explícito tem prioridade. A opção 6 configura os quatro endereços. `diario.mjs` salva os dois resultados independentemente, com mutações de estado serializadas. Falha de conteúdo não repete o Diário concluído; resposta salva evita nova geração em falha de disco. `contentStatus` é acrescido ao estado existente; grupos antigos completos ficam skipped. O timeout usa no mínimo dez minutos, configurável por `diaryRequestTimeoutMs`. A limpeza inclui a nova pasta. O gerador do Diário produz somente o 02b; as definições importáveis completas são `workflows/02b-diario.importar.json` e `workflows/03-conteudos.importar.json`. Para distribuir, use a entrega gerada por preparar-atualizacao.mjs e LEIA-ME-ATUALIZACAO.md.

`atlas.json` usa `schemaVersion: 2`, categorias apenas na raiz e descritores em `notes`: `id`, datas, `sourceId`, `digestId`, `categoryId`, `parentNoteId`, `address`, `title` e o nome do arquivo gerado. A raiz usa letras; notas diretas usam números; níveis seguintes alternam letras e números. IDs técnicos continuam independentes do endereço. O índice só contém headings e linhas vazias; cada `.md` da nota recebe exatamente `block.text`.

O Jev compara todas as opções do nível atual: categorias na raiz, apenas títulos/endereço das notas nos demais níveis. `none` entre notas ou filhos vazios insere a próxima irmã, sem chamar o Criador de Categorias. O Agent cria exatamente uma raiz quando não há raiz adequada e insere imediatamente a primeira nota (`B.1`, por exemplo). Não há limite fixo de quatro níveis para notas. Headings Markdown usam até seis `#`; endereços mantêm a profundidade completa em níveis mais profundos.

A conversão de v1 valida os dados e guarda uma cópia em `Atlas/Backup anterior ao Zettelkasten` antes de alterar registros. Notas antigas recebem endereços sob a raiz existente; subcategorias antigas ficam somente na cópia. Os recortes, IDs, datas de criação e títulos são conservados. As notas antigas de leitura são substituídas por arquivos com endereço e corpo integral.

O Code de corte já retorna um item n8n por recorte. O único Loop Over Items, com lote 1, garante que cada recorte conclua a categorização antes de iniciar o seguinte. Essa sequência permite reutilizar imediatamente categorias recém-criadas. A atualização da árvore acontece no Code de preparação da pergunta de conhecimento. O canvas separa entrada, preparação de notas, classificação por níveis e conclusão do recorte em áreas identificadas.

O Atlas permite até dez minutos de espera pela execução completa; `atlasRequestTimeoutMs`, quando informado em `configuracao.json`, substitui esse limite. Os demais workflows mantêm seu tempo de espera atual.

O workflow do Diário recebe somente `compare` e `finalize`. O executor compara o último input do grupo com o novo, usando seus KeyTopics/bullet points. Uma quebra encerra o grupo anterior e salva a nova janela antes de gerar documentos. Uma única chamada `finalize` executa seis HTTP Requests Jev separados, consolida flags/probabilidades, gera o Diário, percorre as ações true e retorna `{ ok, aspects, diary, achievements, errors, activeRoutes, actionResults }`. Somente Vitória chama o Brag nesta versão. O loop aguarda todos os aspectos ativos antes de responder. `errors.diary` e `errors.brag` indicam falhas parciais; respostas inválidas dos Jevs são erros da finalização, nunca false.

Para personalizar um aspecto, abra **Jev — Vitória**, **Jev — Obstáculo**, **Jev — História**, **Jev — Gratidão**, **Jev — Piada** ou **Jev — Vida pessoal** e edite `instructions` e `criteria` no corpo JSON. Preserve a chave da pergunta (`victory`, `obstacle`, `story`, `gratitude`, `joke`, `personalLife`) e o tipo `noul`, usados na consolidação. Cada Request referencia o texto da entrada validada, mesmo recebendo a resposta HTTP anterior. Os seis nodes são encadeados e representam seis chamadas ao Jev por análise de grupo.

O executor chama Atlas e Diário com `Promise.allSettled` para o mesmo input e aguarda ambos antes do seguinte. As gravações do estado compartilhado são serializadas. Falha na comparação pausa a fila; falha na geração de um grupo concluído fica registrada e pode ser tentada novamente sem impedir a nova janela.

O JSON em `sistema/diario.json` é o estado oficial do agrupamento. `Diário/Grupos` e `Grupo em andamento.md` são projeções regeneradas; os registros finais JSON em Diário e Conquistas conservam seus IDs por grupo. Retornos dos Agents são salvos antes das projeções para evitar repetir a geração após uma falha na escrita.

Se um Agent falhar, uma nova tentativa executa novamente a finalização completa; o Diário já válido é conservado. Para adicionar uma ação, insira os nodes entre o ponto do aspecto e Registrar resultado da ação, retornando um item para continuar o loop. Não adicione respostas HTTP intermediárias.

As definições exportadas usam a credencial existente `OpenRouter account`. Na criação via MCP, confirme a associação dessa credencial tanto ao modelo quanto aos HTTP Requests Jev; o MCP pode associar automaticamente somente o modelo. Os workflows entregues já estão configurados e ativos.

Os testes utilizam pastas temporárias descartáveis. Os arquivos reais do usuário são sempre gravados dentro da pasta deste projeto.

Segmentação v2: frases naturais com subdivisão de trechos acima de 50 palavras em blocos equilibrados. Validador confere o formato/dados, sem rejeitar por rótulo de versão; posições UTF-16 continuam obrigatórias. O gerador 01 inclui validação com diagnóstico específico e retorno direto ao computador; não inclui Agent de correção. Definição completa em workflows/01-digestao.importar.json; Codes individuais disponíveis para atualização sem substituir nodes customizados.

`preparar-atualizacao.mjs` gera a entrega a partir dos arquivos locais: separa programa sem dados/configuração dos Codes 01/02a para colar manualmente. O comando CLI regenera as definições a partir dos geradores e sincroniza somente jsCode das exportações. Não chama o n8n. `prepareUpdate(root)` é testado com configurações/estados privados e simulação de mesclagem em cliente existente.
