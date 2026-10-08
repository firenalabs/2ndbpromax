# Versão 1.0.6 — um arquivo por tweet

Corrige o salvamento de vários conteúdos gerados para a mesma origem. Cada item com `contentKey` próprio recebe um identificador e arquivos `.md` e `.json` distintos em **Conteúdos Gerados**. Antes, os itens do mesmo grupo usavam o mesmo nome e apenas o último permanecia salvo. Repetir o salvamento mantém os nomes, sem duplicar arquivos. Conteúdos antigos sem `contentKey` conservam o comportamento anterior.

**Para atualizar:** opção **9. Atualizar sistema**, depois feche e reabra o programa. Configuração, Diário, Atlas e demais dados são preservados.

**n8n:** esta atualização não altera workflows, prompts, Agents, modelos ou credenciais. Se o workflow de tweets já retorna os itens em `generatedContents` com `contentKey` distintos, não é necessário modificar o n8n. Não reimporte os workflows de referência sobre um workflow personalizado.

Arquivos sobrescritos antes da atualização não são recuperados automaticamente. Os conteúdos podem ser recuperados do JSON final de uma execução existente no n8n, sem chamar a IA novamente.

Validação: testes de vários tweets do mesmo grupo, arquivos separados, conservação do texto e repetição idempotente, além da suíte completa do programa.
