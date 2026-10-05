@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 (
    echo Nao foi possivel abrir a pasta do sistema. Extraia o ZIP em uma pasta local antes de iniciar.
    pause
    exit /b 1
)

if not exist "%~dp0sistema\iniciar.mjs" (
    echo A copia esta incompleta: falta sistema\iniciar.mjs.
    echo Extraia o ZIP inteiro. Cada cliente precisa da pasta sistema junto com iniciar.bat.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Para iniciar, instale Node.js 22 ou superior em https://nodejs.org/
    echo Depois da instalação, feche esta janela e abra iniciar.bat novamente.
    pause
    exit /b 1
)

node "%~dp0sistema\iniciar.mjs" %*
set "iniciar_exit_code=%errorlevel%"
echo.
pause
exit /b %iniciar_exit_code%
