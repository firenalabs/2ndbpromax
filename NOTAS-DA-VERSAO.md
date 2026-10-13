# Versão 1.1.6

- Brag normaliza zeros adicionais nos IDs quando o número corresponde inequivocamente a um segmento existente: SEG_000014 vira SEG_00014. O ajuste é registrado como aviso.
- Não inventa IDs, não troca intervalos invertidos e não muda os limites dos trechos selecionados.
- Valida cada conquista separadamente: uma referência realmente inválida não descarta as demais conquistas válidas.
- Programa conserva conquistas válidas em resultados parciais e novas tentativas. Registra avisos e conquistas rejeitadas no JSON do Diário.
- Preserva integralmente prompts, modelos, configuração dos agentes e layout. A correção no n8n altera somente os dois Codes de validação e montagem final.

O workflow 02b local já está corrigido e publicado. Use a opção 9 para atualizar o programa, reabra o iniciador e escolha 1 para retomar os registros parciais. Nenhuma chamada de IA foi repetida durante os testes desta correção.

Em outros servidores n8n, aplique os Codes de Validar conquistas e trecho literal e Montar Diário e Conquistas completos do arquivo 02b-diario-registros.importar.json no pacote Codes-n8n.zip. Preserve backup e credenciais. A opção 9 não altera workflows de outro servidor.
