# Versão 1.0.7 — posts organizados por rede social

Cada post do novo Diário recebe documentos `.md` e `.json` próprios em **Conteúdos Gerados/LinkedIn**, **Twitter** ou **Instagram**. Os documentos identificam rede, formato e blocos textuais e conservam as avaliações dos Jevs. Pensamentos rápidos e interações são posts independentes; sequências, threads e carrosséis mantêm todas as partes num documento, separadas por `---`. Sequências no LinkedIn ficam num texto. Imagens e PDFs não são gerados.

**Para atualizar o programa:** use **9. Atualizar sistema**, feche e reabra. Dados e configuração são preservados. Clientes com o webhook antigo continuam usando o Diário antigo até que o responsável configure o novo endereço.

**n8n:** `Codes-n8n.zip` inclui `02b-diario-social.importar.json`. Importe como um novo workflow, configure suas credenciais e publique. Preserve o workflow legacy e seu webhook `segundo-cerebro-local-diario-v1`. A cópia usa `segundo-cerebro-local-diario-social-v2`. No cliente, configure `diaryWebhook` com o novo endereço completo e, se necessário, `diaryRequestTimeoutMs` com `1800000`. A opção 9 não altera esses campos. No ambiente local desta implementação, o novo workflow já está publicado e a cópia em Downloads já está configurada.

A incorporação mantém as faixas de palavras, os prompts originais e as configurações dos Agents/modelos; acrescenta instruções de retorno JSON, organização em JavaScript e adaptações text-heavy acima dos limites indicados nas sticky notes. Os seis Jevs de formato/imagens foram corrigidos conforme a solicitação. Nenhum Output Parser foi acrescentado à geração social.

Validação: 97 testes do programa passaram. As sete faixas foram verificadas no n8n com respostas simuladas, incluindo falhas parciais e adaptações por limite de caracteres. Uma execução retornou 58 posts, todos salvos em 58 Markdown e 58 JSON, com nomes distintos e pastas corretas.
