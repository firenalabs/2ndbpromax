# Versão 1.0.10 — Iniciar unificado

A opção 1 agora se chama Iniciar. Ela faz uma rodada de novas tentativas dos erros existentes, processa os textos que já estão na Entrada e continua aguardando novos textos. As opções 2 e 3 foram retiradas do menu; os números 4, 5, 6, 7 e 9 permanecem iguais. Os comandos de lote e retry continuam disponíveis para scripts existentes.

Erros persistentes ficam registrados e não são recolocados na fila a cada verificação da pasta. Reiniciar com Iniciar permite uma nova rodada de tentativas. As tentativas internas de comunicação já existentes foram preservadas.

Digestão e Atlas dos demais textos continuam mesmo quando outro texto falha. O Diário mantém a ordem original dos textos: depois de uma falha de digestão ou continuidade, aguarda sua resolução ou a opção 5 antes de incorporar os textos seguintes. Resultados concluídos não são gerados novamente.

**Para aplicar:** use 9. Atualizar sistema, feche e reabra o programa e escolha 1. Iniciar.

**n8n:** nenhuma alteração de workflows, prompts, Agents, modelos ou configurações de chamadas.

Validação: 94 testes passaram, incluindo retomada de erros com identidade preservada, Entrada existente, novos textos, falhas persistentes sem repetição no polling, avanço independente do Atlas e preservação da sequência do Diário.
