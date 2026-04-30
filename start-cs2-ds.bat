@echo off
setlocal enabledelayedexpansion
title CS2 Dedicated Server - LAN
color 0A

echo.
echo  =============================================
echo   CS2 Dedicated Server - LAN
echo  =============================================
echo.

set CFG_DIR=%~dp0cs2-configs
set CS2_EXE=
set RCON_PASSWORD=cs2lan

:: ── Procurar cs2.exe automaticamente ────────────────────────
echo  [..] Procurando cs2.exe...

if exist "%~dp0cs2-ds\game\bin\win64\cs2.exe" (
    set CS2_EXE=%~dp0cs2-ds\game\bin\win64\cs2.exe
)

:: Tentar ler caminho do Steam via registro
if "!CS2_EXE!"=="" (
    for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Valve\Steam" /v SteamPath 2^>nul') do (
        set STEAM_PATH=%%b
        set STEAM_PATH=!STEAM_PATH:/=\!
        if exist "!STEAM_PATH!\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe" (
            set CS2_EXE=!STEAM_PATH!\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe
        )
    )
)

:: Caminhos comuns do Steam
if "!CS2_EXE!"=="" (
    for %%D in (C D E F) do (
        if "!CS2_EXE!"=="" (
            for %%P in (
                "%%D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\SERVER_CS2\cs2-ds\game\bin\win64\cs2.exe"
                "%%D:\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\Program Files\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\Games\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\CS2\game\bin\win64\cs2.exe"
                "%%D:\cs2\game\bin\win64\cs2.exe"
                "%%D:\CS2DS\game\bin\win64\cs2.exe"
            ) do (
                if exist %%P set CS2_EXE=%%~P
            )
        )
    )
)

:: Resultado
if "!CS2_EXE!"=="" (
    echo  [ERRO] cs2.exe nao encontrado automaticamente.
    echo.
    echo  Abra o Steam ^> CS2 ^> clique direito ^> Gerenciar
    echo  ^> Procurar arquivos locais.
    echo.
    echo  Copie o caminho da pasta que abrir, adicione:
    echo  \game\bin\win64\cs2.exe
    echo.
    echo  Depois edite este arquivo e troque a linha:
    echo  set CS2_EXE=SEU_CAMINHO_AQUI
    echo.
    set /p CS2_EXE=  Cole o caminho completo do cs2.exe aqui: 
    if not exist "!CS2_EXE!" (
        echo  [ERRO] Caminho invalido. Encerrando.
        pause
        exit /b 1
    )
)

echo  [OK] CS2 encontrado:
echo  !CS2_EXE!
echo.

:: Pasta cfg do CS2 (sobe dois niveis do bin\win64 para chegar em game\)
for %%F in ("!CS2_EXE!") do set CS2_BIN=%%~dpF
for %%X in ("!CS2_BIN!..\..") do set GAME_DIR_R=%%~fX
set CS2_CFG=!GAME_DIR_R!\csgo\cfg

if not exist "!CS2_CFG!" mkdir "!CS2_CFG!"

echo  [1/2] Copiando configs do painel para o CS2...
copy /Y "%CFG_DIR%\server.cfg"   "!CS2_CFG!\server.cfg"   >nul
copy /Y "%CFG_DIR%\warmup.cfg"   "!CS2_CFG!\warmup.cfg"   >nul
copy /Y "%CFG_DIR%\match.cfg"    "!CS2_CFG!\match.cfg"    >nul
copy /Y "%CFG_DIR%\knife.cfg"    "!CS2_CFG!\knife.cfg"    >nul
copy /Y "%CFG_DIR%\practice.cfg" "!CS2_CFG!\practice.cfg" >nul
echo  [OK] Configs copiados para: !CS2_CFG!
echo.

:: Mostrar IP da maquina para os jogadores conectarem
echo  [2/2] Seu IP na rede local (para os jogadores):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW_IP=%%a
    set RAW_IP=!RAW_IP: =!
    echo  !RAW_IP!:27015
)
echo.
echo  =============================================
echo   Iniciando servidor CS2...
echo   Mapa inicial: de_mirage
echo   Porta: 27015
echo   Modo: LAN (sv_lan 1)
echo  =============================================
echo.
echo  Nao feche esta janela durante o evento!
echo  Use o painel (localhost:3001) para controlar.
echo.
echo  =============================================
echo   COMO CONECTAR NO SERVIDOR:
echo   (a lista LAN do CS2 pode nao mostrar o
echo    servidor quando cliente e DS estao no
echo    mesmo PC - use o console direto)
echo.
echo   1. No CS2, pressione a tecla til (~)
echo   2. Digite: connect 127.0.0.1:27015
echo.
echo   Outros PCs da LAN: connect IP_ACIMA:27015
echo  =============================================
echo.

"!CS2_EXE!" -dedicated ^
    -console ^
    -usercon ^
    -ip 0.0.0.0 ^
    +rcon_password "%RCON_PASSWORD%" ^
    +game_type 0 ^
    +game_mode 1 ^
    +sv_lan 1 ^
    +sv_lan_ss 1 ^
    +host_info_show 2 ^
    +map de_mirage ^
    +exec server.cfg ^
    -port 27015 ^
    +tv_enable 1 ^
    +tv_port 27020 ^
    -maxplayers_override 10
