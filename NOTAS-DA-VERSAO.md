# Versão 1.1.11

- Navegação principal por família de input em Conteúdos Gerados/índice.md e Famílias/<nome — inputId>, com índices por contentType.
- Centraliza os textos únicos em Acervo/<generationId>/<contentType>/conteudo.md. Preserva posts independentes, blocos, legendas, metadados e origem.
- Conteúdos de grupos A+B aparecem nas famílias A e B, identificados como compartilhados e apontando ao mesmo arquivo. Resultados dos recortes e do Diário podem chegar em momentos distintos e são reunidos nos índices.
- Pedidos e respostas de execução ficam em Pedidos/gen-... para rastreabilidade e retomada. Copias da apresentação anterior são conservadas nesses pedidos.
- Opção 4 atualiza organização/índices sem chamadas de IA. Opções 2 e 3 também atualizam os índices após resultados.
- Migração conserva IDs, caches, estados e saídas válidas acumuladas em tentativas anteriores. Não muda decisões de continuidade, workflows, prompts, modelos ou chamadas.

Use opção 9, reinicie e escolha 4. Abra Conteúdos Gerados/índice.md. Não é necessário alterar nodes no n8n de produção.

148 testes passaram, incluindo grupo multi-input com links ao mesmo conteúdo, tipos chegando em etapas diferentes, ensaios independentes, migração com saídas acumuladas e recuperação de interrupção. Também foi validada uma cópia de dados de Sisteminha1, com quatro famílias e 13 materiais. Sem chamadas de IA.
