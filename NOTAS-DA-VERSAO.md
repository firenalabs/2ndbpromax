# Versão 1.1.4

- Diário envia o texto segmentado e o mapa UTF-16 já preparados pelo workflow 01, junto do texto original.
- Escrivão Brag Document retorna segmentoInicial e segmentoFinal por conquista. O código extrai integra literalmente do original, incluindo o segmento final, sem depender de cópia feita pelo modelo.
- Conquistas guardam os IDs de segmentos e as posições de origem no JSON e no Markdown.
- Registros antigos pendentes recuperam o mapa dos KeyTopics salvos antes da nova tentativa. Quando esse material antigo não existe, a segmentação é reconstruída deterministicamente, sem chamada de IA, com aviso no terminal.
- IDs inexistentes, intervalos invertidos e mapas divergentes são rejeitados. O registro do Diário permanece conservado quando o Brag falha.
- Preserva objetivo, modelo, demais instruções e configurações do Brag. Ajusta somente sua entrada e o formato de retorno, além do schema já existente.

Use a opção 9 para atualizar e reabra o iniciador. A opção 1 retoma os registros pendentes; os registros concluídos não são regenerados. Configuração, histórico, textos e resultados são preservados.

O workflow 02b no n8n local já foi atualizado e publicado. Em outros servidores, aplique também o arquivo 02b-diario-registros.importar.json do pacote Codes-n8n.zip, preservando backup e credenciais. A opção 9 atualiza o programa, mas não altera workflows de outro servidor. Durante a atualização, clientes antigos ainda funcionam com o novo workflow usando a mesma segmentação determinística.
