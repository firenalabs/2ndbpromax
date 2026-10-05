# Recortes

Cada **.json** é um Objeto P: texto recortado integral, tópico, bullet points, contagem de palavras e referência ao original.

Todos os recortes são conservados, inclusive os que não entram no Atlas. O campo `status` indica:

- `created`: salvo e aguardando análise.
- `prepared`: aceito pelo Jev, com título, aguardando categoria.
- `filtered`: o Jev não o classificou como conhecimento suficiente.
- `accepted`: incluído numa categoria do Atlas.

O identificador SEG marca a frase inicial dentro daquele texto. Para leitura, prefira **Atlas de Conhecimento.md** na pasta acima ou os arquivos de **Notas**. Não precisa editar estes registros.
