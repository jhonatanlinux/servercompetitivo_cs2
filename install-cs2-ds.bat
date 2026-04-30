@echo off
title Instalando CS2 Dedicated Server
color 0B

echo.
echo  =============================================
echo   CS2 Dedicated Server - Instalacao
echo   Download gratuito, sem conta Steam
echo  =============================================
echo.
echo  AVISO: Download de ~14GB. Pode demorar.
echo.
pause

set DS_DIR=%~dp0cs2-ds

if not exist "%DS_DIR%" mkdir "%DS_DIR%"

set STEAM_DIR=%~dp0steamcmd

if not exist "%STEAM_DIR%" mkdir "%STEAM_DIR%"

echo  [1/3] Baixando SteamCMD...

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile '%STEAM_DIR%\steamcmd.zip'"

if %errorlevel% neq 0 (
    echo  [ERRO] Falha ao baixar SteamCMD. Verifique sua conexao.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%STEAM_DIR%\steamcmd.zip' -DestinationPath '%STEAM_DIR%' -Force"

del "%STEAM_DIR%\steamcmd.zip" >nul 2>&1
echo  [OK] SteamCMD pronto.
echo.

echo  [2/3] Instalando CS2 Dedicated Server (AppID 730)...
echo  Aguarde - isso pode demorar varios minutos.
echo.

"%STEAM_DIR%\steamcmd.exe" +force_install_dir "%DS_DIR%" +login anonymous +app_update 730 validate +quit

if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Falha na instalacao. Verifique sua conexao e tente novamente.
    pause
    exit /b 1
)

echo.
echo  [OK] CS2 Dedicated Server instalado em:
echo  %DS_DIR%
echo.
echo  Execute agora: start-cs2-ds.bat
echo.
pause
