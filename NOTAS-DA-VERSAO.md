# Versão 1.1.10

- Opção 2 cria um pedido e uma pasta por insumo original, identificados pelos IDs do insumo e da digestão. Recortes de entradas diferentes não compartilham pedidos, mesmo com o mesmo nome de arquivo.
- Continua chamando o n8n uma vez por recorte. Os textos não eram concatenados anteriormente; o problema estava no pedido/pasta comum.
- Novas pastas de recortes incluem o nome do insumo, e pedido.json/índice.md identificam a origem.
- Pedidos antigos misturados são separados automaticamente, preservando IDs das gerações, estados, respostas salvas e checkpoints. Apenas recortes pendentes são retomados.
- O pedido original é conservado em Histórico de pedidos reorganizados. A migração persiste seu plano e termina após interrupções sem duplicar pedidos.
- Não altera workflows, prompts, modelos, chamadas ou agrupamento editorial do Diário.

Use opção 9, reinicie e escolha opção 2. A separação dos pedidos existentes acontece ao inicializar geração (opção 2 ou 3), sem chamadas de IA. Não é necessário atualizar nenhum node no n8n de produção.

143 testes passaram. Casos incluem origens com mesmo nome, vários recortes por origem, proibição de pedidos misturados, migração com retomada parcial e duas interrupções em etapas distintas. Os testes usam respostas simuladas, sem consumo de tokens de IA.
