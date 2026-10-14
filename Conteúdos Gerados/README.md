# Conteúdos por família de input

Abra **índice.md** e escolha o input original. A família reúne todos os contentTypes produzidos pelos seus recortes e pelos grupos editoriais do Diário que o utilizaram, mesmo em gerações realizadas em momentos diferentes.

- **Famílias/<nome — inputId>/índice.md**: todos os tipos e andamento desse input.
- **Famílias/<nome — inputId>/<contentType>/índice.md**: posts e links para os arquivos únicos; referencias.json e familia.json permitem consultar os IDs, materiais e destinos.
- **Acervo/<generationId>/<contentType>/conteudo.md**: texto único, com todos os posts independentes daquele material/tipo em seções P01, P02…; preserva blocos, sequências, slides e legendas.
- **Acervo/<generationId>/origem.json**: inputs, recorte/grupo, segmentos/composição e referência às fontes do pedido.
- **Pedidos/gen-...**: pedido.json, índices técnicos, Fontes e respostas de execução para auditoria/retomada.

Se um grupo usa A+B, os conteúdos aparecem nas famílias A e B com a indicação da composição, mas os links apontam ao mesmo arquivo. Conteúdos diferentes do mesmo tipo permanecem separados pelos materiais e pelas identidades dos posts.

Use a opção 4 para atualizar esta organização sem gerar conteúdos. Opções 2 e 3 também atualizam os índices conforme os resultados chegam. A migração conserva caches, estados e cópias da apresentação anterior nos pedidos; arquivos manuais e configurações são preservados. Não exige alterações no n8n.
