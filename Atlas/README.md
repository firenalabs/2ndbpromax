# Atlas de Conhecimento

Abra **Atlas de Conhecimento.md** para consultar o índice: somente categorias de primeiro nível e títulos das notas, com seus endereços.

- **Notas/**: arquivos como `A.1 - Título da nota.md`, contendo apenas o recorte integral, sem cabeçalhos ou metadados.
- **Recortes/**: objetos JSON completos, incluindo origem, bullet points, avaliação Jev e posição da nota.
- **atlas.json**: categorias raiz e árvore de notas; fonte oficial dos endereços.

O Jev escolhe uma categoria raiz e compara os títulos das notas irmãs. Quando escolhe uma nota, analisa seus filhos; quando não encontra encaixe ou filhos, insere a nova nota como próxima irmã. O Criador de Categorias atua somente para uma nova raiz.

Os endereços são estáveis: `A.1`, `A.2`, `A.1.A`, `A.1.B`, `A.1.A.1`. Não é necessário numerar inputs nem criar pastas manualmente.

Dados do formato anterior são convertidos automaticamente: notas existentes ficam sob sua categoria raiz, com IDs e recortes preservados. Uma cópia fica em **Backup anterior ao Zettelkasten** quando houver conversão. Subcategorias antigas não viram notas artificiais.
