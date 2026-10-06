O workflow 01 agora usa **Agent: KeyTopics → Estruturar KeyTopics em JavaScript → Validar e montar digestão**. O Agent retorna Markdown padronizado e o Code converte para JSON sem outra chamada à IA. Aspas nos bulletpoints não exigem escapes de JSON. O formato antigo com SEG no fim do título também é aceito. Estruturas incompletas retornam erro claro; IDs inexistentes, repetidos ou fora de ordem continuam sendo rejeitados.

**n8n local:** atualizado e publicado. Modelo, temperatura, credencial e instruções de análise do Agent foram preservados.

**n8n produção (manual):** no 01, remova Schema — KeyTopics e Agent: Estruturar KeyTopics. Desative Require Specific Output Format do Agent: KeyTopics. Adicione um Code chamado Estruturar KeyTopics em JavaScript entre Agent: KeyTopics e Validar e montar digestão, com o conteúdo do arquivo de mesmo nome em Codes-n8n.zip. Atualize também o Code Validar e montar digestão. Remova do prompt exigências de JSON e acrescente as instruções do arquivo 01 - Formato Markdown KeyTopics.txt, preservando a análise e o modelo atuais. Publique o workflow. 02a, 02b e 03 não precisam ser alterados para esta mudança.

**Computador:** o contrato de resposta é o mesmo; não precisa atualizar para consumir a nova digestão. A opção 9 instala os arquivos de programa da 1.0.4, preservando configuração e dados, mas não altera o n8n.
