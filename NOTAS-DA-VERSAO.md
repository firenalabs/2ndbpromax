# Versão 1.0.8 — migração automática do Diário para o v2

Corrige instalações que receberam o código novo pela opção 9, mas continuaram chamando o workflow legacy por conservar o webhook antigo em `sistema/configuracao.json`.

**Para aplicar:** escolha **9. Atualizar sistema**, feche e reabra o iniciador. No primeiro início com o código novo, o caminho `/webhook/segundo-cerebro-local-diario-v1` passa para `/webhook/segundo-cerebro-local-diario-social-v2`. A migração funciona mesmo quando a atualização foi instalada pelo atualizador da versão anterior.

Servidor, protocolo, porta, prefixos de proxy, parâmetros da URL, limiares e demais configurações são preservados. Endpoints personalizados e URLs de teste não são alterados. A configuração anterior é guardada em **Atualizações/Backups/migracao-diario-social-v2/configuracao.json** antes da gravação. A migração acontece uma vez; se o responsável escolher voltar ao legacy depois, o programa mantém essa escolha.

**n8n:** o workflow v2 precisa estar publicado no servidor do cliente. Esta versão não altera workflows, posicionamento de nodes, prompts, Agents ou modelos. O workflow legacy permanece disponível.

Validação: 102 testes passaram, incluindo preservação do servidor e configurações, URLs com proxy/porta/parâmetros, endpoints personalizados, backup, repetição, retorno voluntário ao legacy e instalação pelo atualizador anterior.
