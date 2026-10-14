# Versão 1.1.9

- Remove quatro agentes de redução para LinkedIn/Instagram e seus desvios de limite, cache e repasses: 24 nodes a menos. Mantém textos-base integrais, mesmo acima dos limites de publicação.
- Prompts, modelos, chamadas e layout dos agentes editoriais restantes permanecem iguais. Sticky notes de Opinião/Educativo indicam a nova regra.
- Workflow retorna contents: uma unidade editorial com blocos, legenda e destinos por rede, sem cópias textuais por plataforma.
- Organiza pedidos em grupo/recorte > contentType > conteudo.md + metadados.json. Um Markdown por tipo reúne P01, P02…; posts independentes não são fundidos. Redes, formatos e decisões de imagens ficam nos metadados.
- Ao iniciar opções 2 ou 3, reorganiza resultados existentes com resposta salva sem chamar IA. Preserva execuções para auditoria e arquivos manuais; remove somente cópias antigas cujo pedido e geração sejam comprovados.
- Retomadas conservam saídas válidas anteriores e checkpoints. Pendências agora mostram a mensagem real em vez de [object Object].

Workflow 03 local já atualizado e publicado. Atualize o programa pela opção 9 e reinicie antes de gerar. Em produção, a opção 9 não altera workflows: use o JSON 03-editorial ou as instruções 03 - CONTEÚDO CENTRALIZADO.txt e os dois Codes do pacote Codes-n8n.zip. Preserve credenciais e evite webhooks duplicados.

Verificação: 137 testes automatizados; cinco execuções locais de cópia temporária com Agents/Jevs simulados, cobrindo grupos, recortes, texto >3000 caracteres, falha parcial e retomada com cache. Sem consumo de tokens de IA. Cópia temporária despublicada e arquivada.
