@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
rem Limpa o status anterior antes de verificar o acesso a pasta.
cmd /d /c exit 0
pushd "%~dp0"
if errorlevel 1 (
    echo [PASTA_INACESSIVEL] Nao foi possivel acessar a pasta do sistema.
    echo Pasta: "%~dp0"
    echo Verifique se a pasta existe e se voce tem acesso a ela.
    pause
    exit /b 1
)

if not exist "%~dp0sistema\iniciar.mjs" (
    echo [ARQUIVO_AUSENTE] A copia esta incompleta: falta sistema\iniciar.mjs.
    echo Pasta: "%~dp0"
    echo Extraia o ZIP inteiro. Cada cliente precisa da pasta sistema junto com iniciar.bat.
    pause
    popd
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Para iniciar, instale Node.js 22 ou superior em https://nodejs.org/
    echo Depois da instalação, feche esta janela e abra iniciar.bat novamente.
    pause
    popd
    exit /b 1
)

node "%~dp0sistema\iniciar.mjs" %*
set "iniciar_exit_code=%errorlevel%"
popd
if not "%iniciar_exit_code%"=="0" echo O sistema terminou com codigo %iniciar_exit_code%. Veja a mensagem acima.
echo.
pause
exit /b %iniciar_exit_code%
