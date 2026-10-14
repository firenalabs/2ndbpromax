# Versão 1.1.13

- Remove a trava de 170 caracteres dos títulos de notas do Atlas. Títulos completos e não vazios são aceitos no workflow e na árvore armazenada pelo programa, inclusive nas execuções seguintes.
- Mantém a proteção de 240 bytes para nomes de arquivos; apenas o nome físico pode ser abreviado. O título integral permanece nos dados e no índice do Atlas.
- Não altera prompts, modelos, conexões, layout ou regras de roteamento dos Agents.
- No n8n local, a correção foi aplicada e publicada somente em `Montar nota preparada` e `Validar pedido do Atlas`, no workflow `Protótipo local — 02a Organizar Atlas de Conhecimento`.

Atualize o programa pela opção 9 e reinicie o iniciador. Em outro servidor n8n, substitua os dois nodes indicados usando o pacote atualizado e publique o workflow. Atualizar o programa não modifica workflows em servidores externos.

152 testes passaram, incluindo títulos de 179, 186 e 1000 caracteres, Unicode, persistência de títulos longos na árvore e proteção independente do nome do arquivo. Não foram feitas chamadas de IA para testar a correção.
