@echo off
setlocal
title Atualizar CS2 Dedicated Server
color 0B

echo.
echo  =============================================
echo   Atualizar CS2 Dedicated Server
echo  =============================================
echo.
echo  Feche o servidor antes de atualizar.
echo  O CS2 cliente pode ficar aberto, mas se der erro,
echo  feche tudo que for CS2/Steam e execute novamente.
echo.
pause

set STEAM_DIR=%~dp0steamcmd
set DS_DIR=%~dp0cs2-ds

if not exist "%STEAM_DIR%\steamcmd.exe" (
    echo  [ERRO] SteamCMD nao encontrado em:
    echo  %STEAM_DIR%\steamcmd.exe
    pause
    exit /b 1
)

if not exist "%DS_DIR%" mkdir "%DS_DIR%"

echo  [..] Atualizando CS2 DS em:
echo  %DS_DIR%
echo.

"%STEAM_DIR%\steamcmd.exe" +force_install_dir "%DS_DIR%" +login anonymous +app_update 730 validate +quit

if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Update falhou.
    echo  Execute este .bat como Administrador se aparecer:
    echo  Staging folder not writable / Disk write failure.
    pause
    exit /b 1
)

echo.
echo  [OK] CS2 Dedicated Server atualizado.
echo.
pause
