# Versão 1.1.7

- Atlas aceita títulos longos na resposta estruturada do Preparador de Notas. O Code normaliza espaços e abrevia entre palavras para respeitar o limite de 150 caracteres do armazenamento.
- O título completo permanece em originalTitle no recorte do Atlas. Conteúdo original e regras de classificação permanecem iguais.
- Prompts, modelos, chamadas e conexões dos agentes foram preservados. Apenas o schema do título e o Code Montar nota preparada mudam no workflow.
- Codes-n8n.zip inclui os dois arquivos e instruções para aplicar a correção sem substituir o workflow completo.

O workflow Atlas local já está corrigido e publicado. Em produção, aplique manualmente Input Schema de Schema — Título da nota e o JavaScript de Montar nota preparada, depois publique. A opção 9 atualiza o programa; não altera workflows no servidor n8n.

130 testes passaram, incluindo o título de 154 caracteres relatado, limites, Unicode e conservação dos agentes. Nenhuma chamada de IA foi repetida nos testes.
