# Conteúdos Gerados

Use a opção 2 para os recortes pendentes ou a opção 3 para os grupos dos registros originais do Diário. Cada pedido tem uma pasta `gen-[data-hora]-[origem]`.

- `índice.md`: fontes, estado de cada grupo/recorte e links para seus resultados.
- `R01 — assunto/` ou `G01 — assunto/`: resultados de um recorte ou grupo.
- Dentro dessa pasta, `opiniao/`, `educativo/`, `utilidade/`, `resumo/`, `storytelling/`, etc.: cada tipo tem um único `conteudo.md` com todos os seus posts independentes, numerados P01, P02...
- `metadados.json`: identidades de cada post, redes e formatos previstos, referência ao Markdown, decisões de imagens e rastreamento da execução. Não repete o corpo textual.
- `origem.json`: origem, IDs dos inputs/digestões e limites dos segmentos ou decisões de continuidade do grupo.
- `Fontes/`: textos usados e respostas das execuções, preservados para auditoria e retomada.

Redes são destinos do mesmo conteúdo-base. Não há redução por limites de LinkedIn/Instagram nesta etapa. Threads, slides e sequências preservam seus blocos ordenados no mesmo documento; legendas-base e chamadas de ensaio são conservadas.

Ao iniciar uma opção de geração, o programa reorganiza também resultados antigos que possuem resposta salva, sem chamar IA. Copias antigas por rede são removidas somente quando seus IDs comprovam que pertencem ao mesmo pedido; arquivos de execução e arquivos manuais são preservados. Se uma resposta antiga não permite recuperar um texto-base comum, os textos diferentes permanecem como variantes dentro do Markdown.
