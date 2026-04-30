@echo off
setlocal enabledelayedexpansion
title CS2 LAN Manager
color 0A

echo.
echo  =============================================
echo   CS2 LAN Manager
echo  =============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js nao encontrado. Baixe em nodejs.org
    pause
    exit /b 1
)
echo  [OK] Node.js encontrado.

if not exist "%~dp0backend\node_modules" (
    echo  [..] Instalando dependencias npm...
    cd /d "%~dp0backend"
    call npm install --no-audit --no-fund
    cd /d "%~dp0"
    echo  [OK] Dependencias instaladas.
) else (
    echo  [OK] Dependencias ok.
)

if not exist "%~dp0cs2-ds\game\bin\win64\cs2.exe" (
    echo  [AVISO] Servidor dedicado nao encontrado em:
    echo         %~dp0cs2-ds\game\bin\win64\cs2.exe
    echo         O backend tentara usar D:\CS2 como fallback.
) else (
echo  [OK] CS2 Dedicated Server encontrado.
)

if exist "%~dp0INICIAR-MARIADB.bat" (
    call "%~dp0INICIAR-MARIADB.bat"
)

echo.
echo  IP da maquina na rede local:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set IP=%%a
    set IP=!IP: =!
    echo  !IP!:27015
)

echo.
echo  [..] Iniciando painel web (porta 3001)...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/status -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    echo  [OK] Painel ja esta rodando na porta 3001.
) else (
    start "CS2 LAN - Painel" cmd /k "cd /d ""%~dp0backend"" && node server.js"
)

echo  [..] Aguardando painel subir (3s)...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3001"

echo.
echo  =============================================
echo   Painel pronto: http://localhost:3001
echo.
echo   Inicie o servidor pelo proprio painel:
echo   - Competitivo sem skins
echo   - Mix com skins
echo.
echo   Conexao local no jogo:
echo   connect 127.0.0.1:27015
echo.
echo   Outros PCs da LAN usam o IP listado acima.
echo  =============================================
echo.
pause
