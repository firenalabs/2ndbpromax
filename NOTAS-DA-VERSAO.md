# Versão 1.1.8

- Título do Atlas com alvo de 130 caracteres e faixa desejada de 110–150, sem mínimo obrigatório. Limite máximo aceito: 170 caracteres.
- Não corta nem abrevia títulos. Acima de 170 registra pendência específica e preserva o retorno completo em originalTitle para revisão.
- Validações da árvore do Atlas no programa e no workflow aceitam o mesmo limite de 170, inclusive em próximas execuções.
- Acrescenta somente orientação de comprimento ao System Message do Preparador de Notas, preservando instruções existentes, modelos e demais configurações.

O Atlas local foi corrigido e publicado. Em produção, acrescente a instrução de comprimento ao Agent: Preparador de Notas e substitua os Codes Montar nota preparada e Validar pedido do Atlas. O Schema — Título da nota precisa estar sem maxLength (mesmo JSON da versão 1.1.7), para que o Code preserve e registre títulos acima do limite. Os quatro arquivos e instruções estão em Codes-n8n.zip.

Atualize também o programa com opção 9 e reinicie para aceitar títulos de até 170. A opção 9 não altera o servidor n8n. Testes incluem o título de produção com 154 caracteres, aceito integralmente, e os limites de 170 e 171, sem chamadas de IA.
