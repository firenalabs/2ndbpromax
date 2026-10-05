# 2ndBrainProMax — segundo cérebro local

Coloque textos `.txt` em **Entrada**. O programa preserva os originais, identifica ideias, organiza o **Atlas de Conhecimento** e reúne textos consecutivos para gerar **Diário** e **Conquistas**. **Conteúdos Gerados** são acionados manualmente.

## Instalar

1. Instale **Node.js 22 ou superior**. Não precisa instalar Git nem executar npm install.
2. Na [última Release](https://github.com/firenalabs/2ndbpromax/releases/latest), baixe **Sistema-Completo.zip** e extraia inteiro.
3. Windows: abra **iniciar.bat**. Linux/macOS: execute **./iniciar.sh** nesta pasta.
4. Use **6. Configurar endereço do n8n** para informar o domínio acessível do seu servidor.
5. Use **1. Iniciar e aguardar novos textos**, depois coloque arquivos em Entrada.

Em uma instalação nova, a configuração inicial é criada automaticamente. Cada computador precisa alcançar o n8n configurado: localhost aponta para o próprio computador. O servidor precisa ter os workflows publicados e as credenciais OpenRouter configuradas.

## Menu

| Opção | Ação |
| --- | --- |
| 1 | Aguardar novos textos em Entrada |
| 2 | Processar os textos que já estão em Entrada |
| 3 | Tentar novamente os textos com erro |
| 4 | Ver o andamento |
| 5 | Ignorar o primeiro texto com erro e seguir |
| 6 | Configurar endereço do n8n |
| 7 | Limpar dados e começar de novo, com confirmação |
| 8 | Gerar conteúdos dos grupos já concluídos |
| 9 | Atualizar sistema pelo GitHub |

Para parar, pressione Ctrl+C e aguarde “Sistema parado”. Arquivos são processados um a um, por data de modificação, com desempate pelo nome. Nenhuma numeração é exigida; coloque os textos na ordem desejada quando houver continuidade.

## Atualizar

Abra o iniciador e escolha **9. Atualizar sistema**. Ele consulta a última Release estável, baixa e verifica o pacote, guarda o código anterior e substitui somente arquivos de programa. Feche e abra novamente após a atualização.

Configuração, textos, histórico, Atlas, Diário, Conquistas e Conteúdos Gerados são preservados. Cada pasta de cliente precisa ser atualizada separadamente. Backups do código ficam em **Atualizações/Backups**.

**Cópias antigas sem opção 9:** baixe Sistema-Completo.zip e extraia na pasta existente, mesclando/substituindo os arquivos. Não apague a pasta sistema. O ZIP não contém configuração particular ou dados; depois dessa primeira atualização, use a opção 9.

O n8n permanece sob atualização manual do responsável. Cada Release informa se é necessário alterar os workflows e inclui **Codes-n8n.zip**, com Codes nomeados pelos nodes de destino. Atualizar o programa não publica workflows.

## Onde encontrar os resultados

| Pasta | Conteúdo |
| --- | --- |
| Entrada | Novos textos UTF-8 `.txt` |
| Originais | Textos originais e seus metadados |
| Processados | Arquivos que concluíram a digestão |
| Digestões | Original, SEGs, KeyTopics e bulletpoints, em JSON/Markdown |
| Atlas | Atlas de Conhecimento.md com categorias/títulos; Notas com recortes integrais |
| Diário | Registros concluídos; Grupo em andamento.md mostra o que aguarda continuidade |
| Conquistas | Brag Document das vitórias identificadas |
| Conteúdos Gerados | Textos gerados pela opção 8, em Markdown/JSON |
| Erros | Explicação das falhas e pendências |
| sistema | Código e configuração; não precisa editar para usar |

Tudo fica dentro da pasta do cliente, mesmo iniciando de outro diretório. Faça uma cópia para cada cliente. Cada cópia tem sua configuração e dados; os mesmos workflows n8n podem atender todas. Não execute o iniciador de dentro do visualizador de ZIP.

## Diário, Atlas e geração de conteúdo

O grupo do Diário só fecha quando o Jev identifica que um novo texto não continua o raciocínio anterior. Tempo, fim do lote e reinício não o fecham. O Atlas recebe cada input sem esperar o fechamento.

SEGs são âncoras determinísticas: frases curtas ou blocos de até 50 palavras para trechos longos sem pontuação. O Agent escolhe os cortes por ideia; o programa confere posições, IDs e original intacto. Versões de digestão/segmentação são metadados, sem bloqueio por número/nome.

Notas do Atlas usam endereços como A.1, A.1.A e A.1.A.1. Só categorias raiz são criadas; nos demais níveis, o Jev compara títulos de notas. Notas contêm apenas o recorte integral; o índice contém apenas categorias e títulos.

A opção 8 chama o workflow 03 somente para grupos fechados ainda pendentes. Até 150 palavras não gera conteúdo; as outras faixas são 151–600, 601–1499 e 1500+. O payload é o mesmo finalize do Diário. Nenhuma correção automática de KeyTopics está configurada.

## Publicar novas versões

No desenvolvimento, altere o código, incremente `version` em package.json e atualize **NOTAS-DA-VERSAO.md** com instruções de n8n quando necessário. Faça commit/push e publique uma tag correspondente, por exemplo `v1.0.1`. O GitHub Actions executa os testes e cria a Release com os pacotes. Commits sem uma nova Release não chegam aos clientes.

`npm test` valida o programa. `npm run gerar-release` gera dist/atualizacao.json. `npm run preparar-atualizacao` prepara as pastas de copiar/colar manualmente, como alternativa.

Configuração particular, dados dos clientes, bloqueios e arquivos temporários estão fora do repositório e dos pacotes publicados. Credenciais OpenRouter ficam no n8n.

## Limites do protótipo

Node.js 22+, até 512 KB por input e 120.000 caracteres por texto/grupo para chamadas ao n8n. Grupos maiores são conservados e ficam pendentes; não são truncados. Falhas conservam o original; use opção 3 após resolver a causa.

A opção 7 apaga os dados daquela cópia, incluindo a Entrada e grupo aberto, após confirmação digitando LIMPAR. Código e configuração são mantidos. Essa limpeza não apaga workflows/históricos do n8n.
