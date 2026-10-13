# Programa local

Execute os lançadores da raiz. Configuração e estados são locais e não entram na entrega do programa.

- `configuracao.json`: endereço do n8n, quatro webhooks, limites e fuso.
- `estado.json`: identidades e estados de recebimento, preparação, Atlas e Diário.
- `diario-registros.json`: registros individuais e pendências de elaboração.
- `geracoes.json`: pedidos, fontes, checkpoints de geração e documentos salvos.
- `diario.json`: histórico anterior dos grupos, preservado na migração.

Opção 1 recebe e registra. Opção 2 gera recortes pendentes de qualquer dia. Opção 3 agrupa registros de um dia e gera por grupo. Não há fechamento automático à meia-noite.

A preparação da entrega utiliza `workflows/build-modular.mjs` e o snapshot `modular-originais.json`, conservando parâmetros de Agents/modelos. Não use os geradores antigos para reconstruir a cadeia modular.
