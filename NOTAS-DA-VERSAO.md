# Versão 1.1.12

- Navegação por coleções editoriais em `Conteúdos Gerados/índice.md`.
- Documentos `.md` ficam diretamente em `Coleções/<assunto — collectionId>/<contentType>`, com nomes que identificam recorte/grupo, assunto e geração. Metadados `.json` ficam ao lado e a pasta `Origens` conserva a rastreabilidade.
- Quando um grupo do Diário reúne A+B, consolida suas coleções e reúne os resultados dos recortes de A, de B e do grupo A+B. Preserva IDs e origens efetivas dos conteúdos, inclusive resultados posteriores de uma só origem.
- Coleções anteriores são registradas como aliases. Ensaios e posts independentes não são deduplicados por semelhança textual ou por tipo.
- Migração automática na primeira abertura do iniciador após instalar pela opção 9. Guarda backup dos conteúdos e do estado editorial em `Atualizações/Backups/colecoes-...` antes de reorganizar. Famílias e Acervo deixam de ser a navegação principal; a apresentação anterior fica no backup.
- Pedidos, fontes e respostas técnicas continuam em `Pedidos`. Preserva checkpoints, estados, resultados parciais e edições já salvas nos documentos.
- Não chama IA para migrar. Não altera workflows, prompts, modelos, decisões de continuidade ou disparos. As opções 2 e 3 continuam manuais neste protótipo.

Na sua instalação atual: execute a opção 9, feche e abra `./iniciar.sh` novamente. A reorganização ocorre antes do menu, sem precisar gerar de novo ou escolher a opção 4. Abra `Conteúdos Gerados/índice.md` ou navegue por `Conteúdos Gerados/Coleções`.

151 testes passaram. Migração validada duas vezes sobre uma cópia dos dados de Sisteminha1: quatro coleções, 49 documentos e 50 posts, com textos preservados e sem chamadas de IA. A união A+B e a chegada tardia de resultados foram validadas em testes específicos.
