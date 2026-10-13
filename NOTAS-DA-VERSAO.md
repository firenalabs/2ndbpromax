# Versão 1.1.2

- Corrige o erro ENOENT ao processar textos depois da limpeza: a cadeia modular salva em KeyTopics Processados e Recortes por Assunto, sem tentar escrever na pasta antiga Digestões.
- Ao reiniciar com a opção 1, reutiliza os KeyTopics já salvos dos textos com erro, sem repetir a chamada de preparação. Atlas e Diário seguem normalmente.
- Mantém a gravação em Digestões para instalações que ainda usam a cadeia antiga.
- Inclui os arquivos de importação atualizados: Atlas organizado em quatro etapas, Diário sem loop de aspectos e geração editorial simplificada, com os blocos visuais organizados.
- Preserva prompts, modelos e configurações das chamadas de IA. Os pontos “conectar ação aqui” do Diário permanecem disponíveis.

Use a opção 9 para atualizar o programa, feche e abra o iniciador novamente e escolha a opção 1 para retomar os textos com erro. Configuração, originais e resultados são preservados; o código anterior recebe backup.

A correção de ENOENT não exige alterações no n8n. A opção 9 não altera workflows do servidor. Para aplicar as melhorias visuais e de estrutura em outro servidor, use os JSONs do pacote Codes-n8n.zip, preserve cópias anteriores e confira as credenciais antes de publicar.
