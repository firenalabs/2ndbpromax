# Versão 1.0.9 — retirada da geração manual de conteúdos

Remove a opção 8 (Gerar conteúdos dos grupos concluídos), o comando correspondente e a integração com o workflow 03 Conteúdos Gerados. A opção 9 continua sendo Atualizar sistema.

Ao reiniciar uma instalação atualizada, o programa remove o webhook manual aposentado e os arquivos de programa antigos que atualizações por mesclagem possam ter conservado. Configurações restantes, documentos já gerados e histórico dos grupos são preservados.

Os conteúdos automáticos retornados por Atlas e Diário continuam funcionando. A configuração do n8n passa a cuidar somente dos três webhooks de digestão, Atlas e Diário. Pacotes manuais e documentação foram atualizados.

**n8n:** despublique e arquive o workflow 03 Conteúdos Gerados no servidor utilizado por cada instalação. Essa ação já foi realizada no n8n local. Os workflows de Atlas e Diário permanecem intactos.

Validação: 91 testes passaram, incluindo remoção em instalações antigas, preservação de documentos e histórico, finalização dos grupos sem chamadas manuais e geração automática.
