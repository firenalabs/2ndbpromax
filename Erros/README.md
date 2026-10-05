# Erros

Se um texto não puder ser processado, aparece aqui um arquivo **.md** com o nome do texto e uma explicação.

O original permanece em **Originais**. Após resolver a causa, inicie o programa e escolha **Tentar novamente os textos com erro**. Falhas na digestão pausam a sequência para preservar a ordem. Arquivos com nome começando por **Atlas —** indicam falha só na organização do conhecimento: a digestão e os recortes já salvos ficam preservados, e os demais textos continuam.

Exemplos de causas: n8n parado, credencial indisponível, arquivo vazio, texto fora do limite ou arquivo que não está em UTF-8.

- **Continuidade —**: a comparação falhou. O grupo anterior e a digestão estão conservados; a fila pausa para preservar a ordem. Tentar novamente retoma a comparação, sem repetir a digestão.
- **Diário —**: um grupo já concluído está aguardando geração do registro. Novos inputs podem continuar.
- **Conquistas —**: falhou a extração ou gravação da conquista. O Diário continua salvo; novos inputs podem continuar.

A opção **Tentar novamente** retoma também Diário e Conquistas pendentes. Erros de geração de grupos não precisam ser ignorados para liberar novos inputs.

Para continuar sem aquele texto, escolha **Ignorar o primeiro texto com erro e seguir** no menu. O original será conservado. Se o problema for no próprio texto, coloque uma versão corrigida em Entrada depois de ignorar o registro anterior.
