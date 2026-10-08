# Atualizar o sistema

Na versão **1.0.7**, posts do novo Diário são salvos em **Conteúdos Gerados/LinkedIn**, **Twitter** e **Instagram**, com rede, formato, blocos textuais e avaliações Jev. Atualize pela opção 9 e reinicie. O workflow original permanece intacto. O novo workflow precisa ser publicado no n8n e seu webhook configurado nos clientes; a atualização automática preserva a configuração existente.

## Para o sócio

Abra iniciar.bat / iniciar.sh e escolha **9. Atualizar sistema**. Aguarde a conclusão, feche e abra novamente. Não precisa Git instalado. Dados e endereço do n8n são mantidos. O código anterior fica em Atualizações/Backups; falha durante a gravação restaura automaticamente os arquivos anteriores.

Se ainda não tiver a opção 9, baixe **Sistema-Completo.zip** em https://github.com/firenalabs/2ndbpromax/releases/latest e extraia na pasta do cliente, mesclando/substituindo os arquivos. Não apague a pasta sistema. Atualize cada cópia de cliente separadamente.

## Para o responsável pelo n8n

Atualizações do programa não alteram o servidor. Leia as notas da Release. Se indicarem mudança nos Codes, baixe **Codes-n8n.zip**, copie cada `.js` inteiro para o Code com o mesmo nome, no workflow indicado, e publique.

Nesta primeira Release, os Codes são **01 — Validar entrada e adicionar SEGs**, **01 — Validar e montar digestão**, **02a — Validar pedido do Atlas** e **02a — Cortar texto deterministicamente**. Eles incluem segmentação de transcrições sem pontuação e validam os dados sem bloqueio pelo nome de versão. Se já aplicou esses Codes, não precisa repetir.

Preserve suas customizações de produção ao substituir a lógica de um Code. O prompt KeyTopics é uma referência; não precisa substituir um prompt customizado. O 03 permanece independente para a opção 8; 02a e 02b possuem geração automática adicional na versão 1.0.5.

Se ainda houver nodes de correção de KeyTopics da entrega antiga, remova **Digestão válida?**, **Agent: Corrigir KeyTopics** e **Validar digestão corrigida**. Conecte **Validar e montar digestão** diretamente ao retorno ao computador. O sistema atual não tenta corrigir automaticamente os KeyTopics.

## Para publicar a próxima atualização

Altere código/geradores, incremente version no package.json, atualize NOTAS-DA-VERSAO.md, execute os testes e envie o commit ao GitHub. Envie uma tag correspondente à versão, por exemplo v1.0.1. GitHub Actions publica os pacotes; os clientes passam a recebê-los pela opção 9.

Somente Releases estáveis são instaladas. Versões antigas não substituem versões novas. O pacote de atualização aceita somente arquivos de programa e verifica seus hashes; configuração e registros locais não são destinos permitidos.

A alternativa manual continua disponível: preparar-atualizacao.bat / ./preparar-atualizacao.sh gera **Atualizações/Atualizacao atual/Copiar para o cliente** e **Colar no n8n**.

Na versão 1.0.5, atualize também o n8n de produção manualmente: o pacote Codes-n8n.zip inclui os workflows 02a/02b com ramificações automáticas e o arquivo CONTEUDOS-AUTOMATICOS.txt. Transfira os novos nodes, ligações e Codes de conclusão, preservando seus prompts e modelos existentes. No computador, a opção 9 atualiza o salvamento em Conteúdos Gerados. Pare e reinicie o iniciador após atualizar.
