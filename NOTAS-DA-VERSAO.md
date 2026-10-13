# Versão 1.1.5

- Corrige invalid syntax nos três Jevs de avaliação de imagens do workflow 03. Os corpos passam a usar JSON.stringify em uma expressão com fechamentos separados.
- Preserva integralmente modelo, texto avaliado, perguntas e critérios. Não modifica agentes de criação de conteúdo, roteamento ou layout.
- Verifica os demais Jevs da cadeia operacional: Atlas, Diário, continuidade e decisões de formatos.
- Arquivos de importação e gerador incluem a correção, evitando que uma nova importação restaure as expressões antigas.

O workflow 03 local já foi corrigido e publicado. Use a opção 3 com o mesmo dia para retomar os pedidos parciais; o programa reutiliza os checkpoints válidos já salvos. Nenhuma execução de produção foi repetida durante a correção.

Use a opção 9 para manter o programa na versão atual. Em outros servidores n8n, aplique a correção do arquivo 03-editorial.importar.json no pacote Codes-n8n.zip, preservando backup e credenciais. A opção 9 não altera workflows de outro servidor.
