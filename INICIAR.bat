@echo off
setlocal enabledelayedexpansion
title MT PRO LEAGUE - CS2 Tournament Manager
color 0A

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "WEB_DIR=%ROOT%apps\web"
set "STEAMCMD=%ROOT%steamcmd\steamcmd.exe"
set "CS2_DIR=%ROOT%cs2-ds"
set "CS2_EXE=%CS2_DIR%\game\bin\win64\cs2.exe"
set "PANEL_URL=http://localhost:3001"

echo.
echo  ============================================================
echo   MT PRO LEAGUE - CS2 Tournament Manager
echo  ============================================================
echo.

call :require_command node "Node.js nao encontrado. Instale em https://nodejs.org"
if errorlevel 1 goto :fail

call :require_command npm "npm nao encontrado. Reinstale o Node.js com npm habilitado."
if errorlevel 1 goto :fail

echo  [OK] Node.js e npm encontrados.

if not exist "%BACKEND_DIR%\package.json" (
    echo  [ERRO] Backend nao encontrado em "%BACKEND_DIR%".
    goto :fail
)

if not exist "%WEB_DIR%\package.json" (
    echo  [ERRO] Front React nao encontrado em "%WEB_DIR%".
    goto :fail
)

call :install_node_deps "%BACKEND_DIR%" "backend"
if errorlevel 1 goto :fail

call :install_node_deps "%WEB_DIR%" "front React"
if errorlevel 1 goto :fail

call :update_cs2
if errorlevel 1 goto :fail

if exist "%ROOT%INICIAR-MARIADB.bat" (
    echo  [..] Verificando MariaDB local...
    call "%ROOT%INICIAR-MARIADB.bat"
) else (
    echo  [AVISO] INICIAR-MARIADB.bat nao encontrado. Pulando MariaDB.
)

echo.
echo  [..] Gerando build atualizado do front React...
cd /d "%WEB_DIR%"
call npm run build
if errorlevel 1 (
    echo  [ERRO] Falha ao gerar build do front React.
    goto :fail
)
cd /d "%ROOT%"
echo  [OK] Build do front React pronto.

echo.
echo  [..] Verificando backend na porta 3001...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/status -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    echo  [OK] Backend ja esta rodando.
) else (
    echo  [..] Iniciando backend...
    start "MT PRO LEAGUE - Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && npm start"
)

echo  [..] Aguardando painel responder...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 20;$i++){ try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3001/api/status' -TimeoutSec 2 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 700 } }; if($ok){ exit 0 } exit 1"
if errorlevel 1 (
    echo  [AVISO] Backend ainda nao respondeu. A janela do backend pode mostrar o erro.
) else (
    echo  [OK] Backend online.
)

echo.
echo  IP da maquina na rede local:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set "IP=%%a"
    set "IP=!IP: =!"
    echo  Painel: http://!IP!:3001
    echo  CS2:    connect !IP!:27015
)

start "" "%PANEL_URL%"

echo.
echo  ============================================================
echo   Painel React: %PANEL_URL%
echo   API:          %PANEL_URL%/api/status
echo   CS2 local:    connect 127.0.0.1:27015
echo.
echo   O painel agora usa somente apps\web. A pasta frontend antiga
echo   foi removida da stack ativa.
echo  ============================================================
echo.
pause
exit /b 0

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] %~2
    exit /b 1
)
exit /b 0

:install_node_deps
set "APP_DIR=%~1"
set "APP_NAME=%~2"
if not exist "%APP_DIR%\node_modules" (
    echo  [..] Instalando dependencias do %APP_NAME%...
    cd /d "%APP_DIR%"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo  [ERRO] npm install falhou no %APP_NAME%.
        cd /d "%ROOT%"
        exit /b 1
    )
    cd /d "%ROOT%"
    echo  [OK] Dependencias do %APP_NAME% instaladas.
) else (
    echo  [OK] Dependencias do %APP_NAME% ok.
)
exit /b 0

:update_cs2
echo.
echo  [..] Verificando CS2 Dedicated Server...

if /i "%SKIP_CS2_UPDATE%"=="1" (
    echo  [AVISO] SKIP_CS2_UPDATE=1 definido. Pulando update do CS2.
    exit /b 0
)

if not exist "%STEAMCMD%" (
    echo  [AVISO] SteamCMD nao encontrado em "%STEAMCMD%".
    if exist "%CS2_EXE%" (
        echo  [OK] cs2.exe existe. Pulando validacao online.
        exit /b 0
    )
    echo  [ERRO] CS2 DS nao instalado. Execute install-cs2-ds.bat primeiro.
    exit /b 1
)

if not exist "%CS2_DIR%" mkdir "%CS2_DIR%"

echo  [..] Checando atualizacao do CS2 DS via SteamCMD.
echo       Isso pode demorar um pouco quando houver update da Valve.
"%STEAMCMD%" +force_install_dir "%CS2_DIR%" +login anonymous +app_update 730 validate +quit
if errorlevel 1 (
    echo  [ERRO] SteamCMD falhou ao validar/atualizar o CS2 DS.
    exit /b 1
)

if not exist "%CS2_EXE%" (
    echo  [ERRO] cs2.exe nao encontrado apos update:
    echo        "%CS2_EXE%"
    exit /b 1
)

if exist "%ROOT%fix-gameinfo.ps1" (
    echo  [..] Reaplicando Metamod no gameinfo.gi...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%fix-gameinfo.ps1"
    if errorlevel 1 (
        echo  [AVISO] fix-gameinfo.ps1 retornou erro. Verifique o gameinfo.gi se o Metamod nao carregar.
    ) else (
        echo  [OK] gameinfo.gi verificado.
    )
)

echo  [OK] CS2 DS verificado.
exit /b 0

:fail
echo.
echo  ============================================================
echo   Falha ao iniciar. Corrija o erro acima e execute novamente.
echo  ============================================================
echo.
pause
exit /b 1
