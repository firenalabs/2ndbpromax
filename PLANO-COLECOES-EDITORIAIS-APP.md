# Coleções editoriais para organização de conteúdos no app principal

**Data:** 14 de outubro de 2026  
**Finalidade:** instrução para implementação posterior no app principal.  
**Status:** proposta funcional aprovada; desenho técnico abaixo é uma orientação a adaptar à arquitetura existente. Este documento não autoriza alterações imediatas nos workflows ou no sistema local.

## 1. Objetivo

O administrador precisa visualizar e planejar juntos os conteúdos relacionados a uma mesma origem editorial, mesmo quando eles são gerados em momentos distintos ou por processos diferentes.

A unidade principal da interface será uma **coleção editorial**. Ao abrir uma coleção, os conteúdos serão organizados por `contentType`.

Uma coleção pode receber conteúdos de:

- Recortes determinísticos de um ou mais inputs que compõem a coleção.
- Grupos editoriais do Diário formados por esses inputs.
- Gerações posteriores solicitadas a partir dos materiais originais guardados.

Não usar o pedido de geração, a execução n8n, a rede social ou o tipo de conteúdo como identidade da coleção.

## 2. Conceitos que devem permanecer separados

| Conceito | Significado | Identidade |
|---|---|---|
| Input original | Texto recebido, preservado integralmente | `inputId` |
| Material de geração | Recorte, grupo editorial ou outro material admitido pela regra existente | `materialId` e `materialKind` |
| Geração | Pedido específico de produção, automático ou posterior | `generationId` |
| Execução técnica | Execução de workflow ou etapa que atende a uma geração | Identificador da execução |
| Conteúdo/publicação | Resultado independente produzido pelos agentes | ID próprio do conteúdo, por exemplo `publicationItemId` |
| Coleção editorial | Conjunto de origens e conteúdos que será apresentado e planejado junto | `collectionId` |

Uma geração pode executar vários agentes e produzir vários conteúdos e tipos. Uma coleção pode reunir várias gerações.

O `contentType` descreve a intenção editorial, como opinião, resumo ou storytelling. Plataforma e formato descrevem os destinos e a apresentação. Preservar essa distinção.

## 3. Comportamento na entrada de um input

Ao receber o input A:

1. Persistir o texto original e sua identidade.
2. Criar uma coleção inicial composta por A, de forma idempotente.
3. Preparar e guardar KeyTopics e recortes conforme as regras existentes.
4. Registrar o input no Diário conforme as regras existentes.
5. Disparar a geração automática de conteúdos do caminho Atlas/recortes.
6. Associar os resultados à coleção de A, organizando-os por `contentType`.

A coleção deve ficar disponível para visualização antes do fechamento diário. Exibir que a consolidação editorial do Diário ainda está pendente.

**Observação sobre a geração inicial:** neste desenho existem dois momentos automáticos: geração por recortes na entrada e geração por grupos no fechamento do Diário. Eles possuem identidades de geração distintas e alimentam a coleção correspondente. “Geração inicial única” significa evitar duplicação indevida dos disparos automáticos previstos, e não atribuir um único ID a todos esses pedidos.

Não condicionar a geração de conteúdos dos recortes à avaliação de conhecimento utilizada para inserção no Atlas. Essa avaliação pertence à organização do Atlas.

## 4. Fechamento do Diário e consolidação das coleções

Ao encerrar o recebimento de inputs do dia, à meia-noite no fuso de negócio configurado:

1. Fixar a seleção de registros daquele dia.
2. Formar os grupos editoriais usando os textos originais e seus KeyTopics, segundo a regra de continuidade existente.
3. Consolidar as coleções dos inputs que passaram a compor um mesmo grupo.
4. Disparar uma geração de conteúdos para cada grupo editorial.
5. Associar seus resultados à coleção consolidada.

**Não utilizar resumos do Escrivão, registros reescritos do Diário ou outputs de Brag como matéria-prima da geração.**

### Exemplo obrigatório

Inputs recebidos:

```text
A = início de uma explicação
B = continuação da explicação
C = outro assunto
```

Antes do fechamento:

```text
Coleção A → conteúdos dos recortes de A
Coleção B → conteúdos dos recortes de B
Coleção C → conteúdos dos recortes de C
```

O Diário identifica:

```text
Grupo editorial 1 = A + B
Grupo editorial 2 = C
```

Depois da consolidação:

```text
Coleção A+B
├── conteúdos dos recortes de A
├── conteúdos dos recortes de B
└── conteúdos gerados pelo grupo A+B

Coleção C
├── conteúdos dos recortes de C
└── conteúdos gerados pelo grupo C
```

Consolidar a apresentação e as associações. Não concatenar outputs já gerados, reescrever conteúdos ou inventar uma nova geração para os resultados antigos.

## 5. Identidade e referências durante a consolidação

As coleções iniciais podem ser consolidadas posteriormente. Essa mudança não pode invalidar links, referências de planejamento ou resultados que ainda estejam sendo gerados.

Desenho técnico recomendado:

- Manter uma coleção canônica para o grupo consolidado.
- Preservar os identificadores das coleções anteriores como referências que resolvem para a coleção canônica.
- Escolher a coleção sobrevivente de forma determinística, por exemplo a mais antiga, com desempate por ID.
- Resolver referências antigas ao consultar ou associar novos resultados.
- Tornar a consolidação idempotente e transacional, ou utilizar mecanismo equivalente já existente no backend.
- Impedir ciclos nas referências entre coleções.
- Preservar a associação de todos os inputs participantes.

Um resultado que chega atrasado com referência à antiga coleção B deve aparecer na coleção A+B, sem ser descartado ou criar outro cartão.

A consolidação não altera IDs dos conteúdos, registros de geração ou snapshots dos materiais utilizados. Ela também não altera estados de aprovação, agendamentos, publicação, produção ou entrega dos `publicationItems`.

**Não consolidar coleções por semelhança textual, mesmo `contentType`, mesma plataforma ou mesmo dia.** A consolidação automática deste desenho ocorre a partir do agrupamento editorial explícito do Diário.

## 6. Gerações posteriores

Os inputs e materiais originais permanecem guardados para permitir novos pedidos de geração.

Ao solicitar uma nova geração a partir de A:

1. Criar um novo `generationId`.
2. Guardar um snapshot ou referências imutáveis dos materiais e inputs efetivamente utilizados.
3. Resolver a coleção à qual A pertence naquele momento.
4. Associar os novos resultados a essa coleção.

Se A foi consolidado com B, os novos resultados de A aparecem na coleção A+B. A origem do conteúdo continua sendo A ou seu recorte específico; a composição da coleção não muda a matéria-prima histórica daquele resultado.

Na interface, distinguir geração automática inicial de geração posterior solicitada, com data e identificação do pedido.

### Nova geração e retomada

- **Retomar uma geração incompleta:** conservar a identidade do pedido, seus resultados válidos e checkpoints, processando o que estiver pendente.
- **Solicitar uma nova geração:** criar outro pedido e preservar os conteúdos anteriores como resultados independentes.

Não recriar conteúdos concluídos por causa de uma atualização dos índices, da consolidação de coleções ou da chegada de outros resultados.

## 7. Rastreamento de cada conteúdo

Cada conteúdo precisa permitir responder:

- Quais inputs originais foram utilizados?
- Qual recorte ou grupo editorial foi utilizado?
- Qual geração produziu o conteúdo?
- Quais execuções técnicas participaram, quando disponíveis?
- Em qual coleção o conteúdo deve aparecer atualmente?

Contrato conceitual de referência, não schema obrigatório:

```ts
type ContentOrigin = {
  sourceIds: string[];            // Inputs efetivamente utilizados
  materialId: string;             // Identidade do recorte ou grupo
  materialKind: 'recorte' | 'grupo' | 'input';
  generationId: string;
};

type EditorialContentAssociation = {
  publicationItemId: string;
  collectionId: string;           // Resolvido para a coleção canônica
  contentType: string;
};
```

Adaptar nomes e enums aos existentes no app. Guardar referências aos recortes e seus segmentos/offsets, ou à composição ordenada do grupo, de modo que seja possível recuperar a matéria-prima.

**A composição da coleção e os `sourceIds` de um conteúdo são informações diferentes.** Uma coleção A+B pode conter um conteúdo produzido exclusivamente a partir de A.

O `publicationItem` continua representando um resultado independente. Não usar `generationId` ou `generationBatchId` como substituto de `collectionId`.

Antes de alterar o schema de `publicationItem`, avaliar associações externas ou consultas que resolvam a coleção. Respeitar as restrições existentes de imutabilidade de produção e de atualização de publicações.

## 8. Interface principal

### Lista de coleções

Exibir um cartão por coleção canônica, com:

- Título reconhecível, baseado no assunto/material da coleção.
- Inputs participantes, com nomes e acesso aos originais.
- Estado do fechamento editorial: aguardando consolidação do Diário ou consolidado.
- Estado de geração apresentado separadamente: em andamento, concluído ou com pendências.
- Quantidade de conteúdos, tipos disponíveis e gerações relacionadas.

Exemplo:

```text
Follow-ups e relacionamento em vendas
Inputs A+B · 18 conteúdos · 7 tipos · 3 gerações
Diário consolidado · Uma geração com pendências
```

Não usar apenas nomes técnicos de workflows, IDs ou horários como título do cartão. Não apresentar cartões antigos consolidados como coleções independentes na lista principal.

### Dentro de uma coleção

Organizar por `contentType`. Dentro de cada tipo, preservar cada post independente e mostrar:

- Conteúdo, partes ordenadas e legenda, quando houver.
- Origem específica: recorte de A, recorte de B ou grupo A+B.
- Geração automática ou posterior, com data.
- Plataformas e formatos previstos, preservando o modelo atual do app.
- Estado de revisão/publicação já existente.

Exemplo:

```text
Coleção: Follow-ups e relacionamento em vendas — A+B

Opinião
  Post 1 — Grupo A+B · Geração automática do Diário
  Post 2 — Recorte de A · Geração posterior

Ensaios
  Ensaio 1 — Recorte de A · Geração automática por recortes
  Ensaio 2 — Grupo A+B · Geração automática do Diário
```

Não fundir ensaios, carrosséis, pensamentos rápidos ou outros posts somente porque possuem o mesmo tipo ou texto semelhante. Preservar também a distinção entre posts independentes e blocos de um mesmo post, como slides ou partes de uma thread.

Oferecer acesso ao histórico de gerações e à consulta por input como visões complementares à coleção.

## 9. Persistência, concorrência e processamento assíncrono

- Os inputs, recortes, grupos e gerações devem ter identidades persistidas.
- Uma atualização de interface deve ser capaz de recompor a coleção a partir dos dados persistidos.
- Eventos ou respostas fora de ordem devem resolver para a coleção canônica correta.
- Reentregas de eventos, retries e reexecuções do fechamento diário não podem duplicar coleções, pedidos automáticos ou associações.
- A seleção do fechamento diário deve ser fixa; novos inputs não devem ser acrescentados silenciosamente a uma geração já iniciada.
- O recebimento na fronteira da meia-noite deve respeitar o fuso e a regra de corte do app, sem deixar um input fora das seleções ou incluí-lo duas vezes.
- A identidade de idempotência do disparo automático deve distinguir a estratégia/material utilizado. Geração por recortes e geração por grupo são pedidos legítimos diferentes.
- Toda associação e consolidação deve respeitar `ownerUserId` e o isolamento entre usuários.
- Uma falha parcial não deve apagar conteúdos já produzidos nem impedir sua visualização.

Não estabelecer um estado único que confunda fechamento editorial com conclusão de geração ou publicação. Esses processos podem terminar em momentos diferentes.

## 10. Orientação ao agente de implementação

1. Ler as instruções do repositório do app principal e identificar a arquitetura e os contratos existentes.
2. Mapear onde inputs, recortes, grupos, gerações e `publicationItems` são persistidos e como são relacionados.
3. Definir o armazenamento mínimo da coleção, participação dos inputs e resolução de coleções consolidadas.
4. Implementar criação idempotente da coleção na entrada e associação dos resultados dos recortes.
5. Integrar consolidação e associação dos resultados ao fechamento editorial do Diário.
6. Integrar as gerações posteriores e a resolução de referências antigas.
7. Construir a lista de coleções e sua visualização por `contentType`.
8. Integrar atualização assíncrona, falhas parciais e rastreamento de origem.
9. Executar testes de domínio, persistência e interface apropriados à implementação.

Preservar regras de preparação do Atlas, continuidade do Diário e escrita dos agentes. Não alterar prompts, modelos ou configurações de chamadas para implementar apenas associação e apresentação.

Não adicionar geração de imagens, conversão de PDF, adaptação por limites de rede ou novas regras de publicação como parte desta tarefa. Não promover uma modularização extensa de workflows.

A organização de pastas do protótipo local serve como referência de origem e rastreamento. A implementação no app deve usar sua persistência e seus contratos; não depende das pastas, IDs locais de workflows ou menus do protótipo.

## 11. Critérios de aceitação

- [ ] Receber A cria uma única coleção inicial e os conteúdos dos seus recortes ficam disponíveis nela.
- [ ] Receber B e C cria coleções iniciais próprias, sem misturar inputs por data ou nome de arquivo.
- [ ] Fechar o dia com grupos A+B e C produz duas coleções canônicas: A+B e C.
- [ ] A+B preserva todos os conteúdos dos recortes de A, dos recortes de B e do grupo A+B.
- [ ] Os conteúdos de C permanecem na coleção C.
- [ ] Tipos gerados em momentos diferentes ficam disponíveis na mesma coleção correspondente.
- [ ] Cada conteúdo exibe os inputs e o material efetivamente utilizados, inclusive quando são um subconjunto da coleção.
- [ ] Dois ensaios do mesmo tipo, feitos por recorte e por grupo, continuam sendo conteúdos independentes.
- [ ] Uma geração posterior de A possui outro ID de geração e entra na coleção A+B.
- [ ] Uma retomada conserva o ID da geração e não duplica resultados já concluídos.
- [ ] Uma resposta tardia destinada à antiga coleção B aparece em A+B.
- [ ] Links e referências aos cartões anteriores continuam resolvendo após a consolidação.
- [ ] Agendamentos, aprovações e estados de publicação existentes são preservados.
- [ ] Repetir o fechamento do mesmo dia não duplica grupos, pedidos automáticos ou coleções.
- [ ] Atualizações concorrentes não perdem conteúdos nem criam ciclos de consolidação.
- [ ] Usuários diferentes nunca compartilham coleções ou resultados indevidamente.
- [ ] Pendências de geração ficam visíveis sem ocultar os resultados válidos.

## 12. Pontos que não devem ser decididos silenciosamente

Os comportamentos principais acima estão aprovados. Antes de ampliar o escopo, explicitar decisões para:

- Geração manual que combina inputs pertencentes a coleções editoriais distintas. Não consolidar automaticamente essas coleções apenas porque foram usadas numa solicitação posterior.
- Edição de grupos depois do fechamento, desmembramento ou consolidação manual de coleções.
- Inputs recebidos tardiamente que pretendam pertencer a um dia já fechado.
- Exclusão de inputs utilizados em gerações ou de coleções com publicações já planejadas.
- Nomenclatura e geração do título das coleções, caso exijam uma nova chamada de IA.

Esses pontos não impedem implementar o núcleo: coleção inicial por input, consolidação pelos grupos do Diário, múltiplas gerações relacionadas e visualização por tipo de conteúdo.
