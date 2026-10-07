# Conteúdos Gerados

Conteúdos automáticos de duas origens:

- **Atlas:** cada recorte aceito pelo Jev pode gerar um conteúdo.
- **Diário:** cada grupo fechado, após os seis Jevs retornarem respostas válidas, pode gerar um conteúdo.

Abra o `.md` para ler. O `.json` guarda título, texto, origem, referência ao recorte/grupo, IDs, datas e quantidades de palavras. Os nomes começam com a data e Atlas ou Diário. A mesma referência reutiliza seus arquivos ao tentar novamente.

As faixas iniciais são 0–150, 151–600, 601–1499 e 1500+ palavras. Edite o Switch e cada Agent/modelo no respectivo workflow para personalizar. O conteúdo retorna na mesma chamada do Atlas/Diário. Erros nessa geração aparecem no terminal e não impedem o processamento original.

A opção 8 continua disponível para gerar conteúdos manualmente pelo workflow 03; esses arquivos são independentes dos automáticos.
