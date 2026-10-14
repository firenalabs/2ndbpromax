# Segundo cérebro — sistema local

Coloque arquivos `.txt` em `Entrada` e execute `./iniciar.sh` (Linux/macOS) ou `iniciar.bat` (Windows). Requer Node.js 22 ou superior e os quatro workflows publicados no n8n, com credenciais OpenRouter configuradas.

1. **Iniciar:** tenta pendências uma vez, recebe textos existentes e aguarda novos. Prepara KeyTopics e recortes, organiza o Atlas e registra cada input no Diário imediatamente. Não gera posts automaticamente.
2. **Gerar conteúdos dos recortes pendentes:** seleciona recortes de qualquer data cuja geração não terminou. Retoma pedidos parciais antes de criar um pedido com novos recortes.
3. **Gerar conteúdos dos registros do Diário:** solicita um dia (`AAAA-MM-DD`, padrão hoje no fuso configurado), forma grupos por continuidade e gera uma execução por grupo. Usa originais e KeyTopics; não usa resumos do Diário.
4. **Ver o andamento.**
5. **Ignorar o primeiro texto com erro e seguir.**
6. **Configurar endereço do n8n.**
7. **Limpar dados e começar de novo:** exige confirmação explícita, apaga dados e subpastas geradas, incluindo redes soltas, pedidos e subpastas de recortes. Remove as pastas antigas `Digestões` e `Geração de Conteúdos`. Preserva código, configuração e pastas pessoais.
9. **Atualizar sistema:** instala a versão publicada no GitHub. Atualizar o programa não altera os workflows do servidor n8n.

Também existem comandos `npm run gerar-recortes` e `npm run gerar-diario -- 2026-10-13`. `npm run lote` e `npm run tentar-novamente` continuam disponíveis para scripts.

## Onde encontrar os dados

- `Originais`: cópias integrais com identidade e ordem de recebimento.
- `KeyTopics Processados`: interpretação, segmentos, KeyTopics e recortes em JSON; versão legível em Markdown.
- `Recortes por Assunto/<sourceId>`: recortes originais compartilhados entre Atlas e geração editorial.
- `Atlas`: recortes avaliados, notas e árvore do conhecimento. Só incorpora conhecimento aceito; não gera posts.
- `Diário/Registros`: um registro por input, sem aguardar o próximo.
- `Diário/Dias`: índice diário determinístico, sem síntese por IA.
- `Conquistas`: extrações com trecho literal que comprova a conquista.
- `Conteúdos Gerados/gen-<data-hora>-<origem>-<id>`: um pedido com `índice.md`, `pedido.json`, `Fontes` e pastas por grupo/recorte (`G01 — assunto` ou `R01 — assunto`). Dentro de cada fonte, os resultados são separados por `contentType`.
- `Conteúdos Gerados/Conteúdos antigos para revisão.md`: avisos de revisão de conteúdos antigos.

Abra o `índice.md` de um pedido para navegar por fonte e tipo de conteúdo. Cada tipo tem um único `conteudo.md`, com seções P01, P02… para posts independentes; `metadados.json` guarda destinos, formatos e rastreabilidade sem repetir o corpo textual. Threads, sequências, carrosséis e legendas preservam seus blocos. Opinião e educativo não são mais reduzidos para limites de LinkedIn/Instagram. Imagens, thumbnails e PDFs são indicações; não são produzidos nesta versão.

Ao iniciar a opção 2 ou 3, o programa reorganiza também resultados já salvos, sem chamar IA. As respostas originais em `Fontes` são preservadas para auditoria. Remove somente as cópias por rede cujos IDs comprovem pertencer ao mesmo pedido. Retomadas conservam conteúdos válidos anteriores e seus checkpoints.

## Retomadas e histórico

Os pedidos usam uma seleção fixa de fontes. Inputs recebidos depois ficam para o próximo pedido. Grupos do Diário são fechados dentro da seleção, incluindo o último, e não são reabertos automaticamente.

Resultados e respostas bem-sucedidas retornadas pelo workflow são persistidos para retomada. Uma falha em uma fonte não impede processar as seguintes. Se uma execução n8n for interrompida antes de devolver suas respostas, os estágios ainda não recebidos pelo programa podem precisar ser chamados novamente. Prompts, modelos e políticas de erro dos Agents foram preservados.

Recortes concluídos não voltam à fila ao mudar prompts. Conteúdos antigos sem evidência de completude das novas saídas ficam em revisão, evitando recriação silenciosa. A reorganização de pedidos com resposta salva não solicita geração nova; arquivos antigos sem origem comprovada são conservados.

## Workflows

1. `Protótipo local — 01 Preparar KeyTopics e Recortes`: `segundo-cerebro-local-digestao-v1`.
2. `Protótipo local — 02a Organizar Atlas de Conhecimento`: `segundo-cerebro-local-atlas-v1`.
3. `Protótipo local — 02b Registrar Diário e Conquistas`: `segundo-cerebro-local-diario-social-v2`.
4. `Protótipo local — 03 Gerar Conteúdos para Redes`: `segundo-cerebro-local-conteudos-v1`.

Os JSONs de importação ficam em `sistema/workflows`. O workflow `NOVO TESTE 09.10.26 DONE` permanece intacto e fora da cadeia operacional.

## Agrupamento dos registros do Diário

Ao selecionar a opção 3, o programa forma os grupos e salva cada um em `Conteúdos Gerados/gen-<data-hora>-diario-<id>/Fontes/G01.md`, `G02.md` etc. O Markdown mostra os originais e o texto integral utilizado; o JSON correspondente guarda identidades, ordem e decisões de continuidade. `pedido.json` registra o conjunto completo e `LEIA-ME.md` oferece links para grupos e posts.

Esses arquivos são gravados pelo programa local durante o pedido de geração. Executar apenas o workflow no editor do n8n não grava as pastas do programa.
