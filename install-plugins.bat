@echo off
setlocal enabledelayedexpansion
title CS2 Plugins - Metamod + CounterStrikeSharp + MatchZy
color 0B

echo.
echo  =============================================
echo   CS2 Plugins Installer
echo   Metamod + CounterStrikeSharp + MatchZy
echo  =============================================
echo.
echo  IMPORTANTE: Feche o CS2 DS antes de continuar!
echo  (gameinfo.gi nao pode ser editado com servidor aberto)
echo.
pause

taskkill /f /im cs2.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: ── Localizar CS2 ───────────────────────────────────────────
set CS2_EXE=
if exist "%~dp0cs2-ds\game\bin\win64\cs2.exe" (
    set CS2_EXE=%~dp0cs2-ds\game\bin\win64\cs2.exe
)
if "!CS2_EXE!"=="" (
    for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Valve\Steam" /v SteamPath 2^>nul') do (
        set SP=%%b
        set SP=!SP:/=\!
        if exist "!SP!\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe" (
            set CS2_EXE=!SP!\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe
        )
    )
)
if "!CS2_EXE!"=="" (
    for %%D in (C D E F) do (
        if "!CS2_EXE!"=="" (
            for %%P in (
                "%%D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\SERVER_CS2\cs2-ds\game\bin\win64\cs2.exe"
                "%%D:\CS2\game\bin\win64\cs2.exe"
                "%%D:\CS2\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
                "%%D:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
            ) do (
                if exist %%P set CS2_EXE=%%~P
            )
        )
    )
)
if "!CS2_EXE!"=="" (
    set /p CS2_EXE=  Cole o caminho completo do cs2.exe: 
)
if not exist "!CS2_EXE!" (
    echo  [ERRO] cs2.exe nao encontrado.
    pause
    exit /b 1
)

for %%F in ("!CS2_EXE!") do set CS2_BIN=%%~dpF
:: Resolver game\ e csgo\ de forma robusta
for %%X in ("!CS2_BIN!..\..") do set GAME_DIR=%%~fX
set CSGO_DIR=!GAME_DIR!\csgo
set GAMEINFO=!CSGO_DIR!\gameinfo.gi
set TMP=%~dp0plugins-tmp

echo  [OK] CS2: !CS2_EXE!
echo  [OK] game: !GAME_DIR!
echo  [OK] csgo: !CSGO_DIR!
echo.

if not exist "%TMP%" mkdir "%TMP%"

:: ── 1. Metamod ───────────────────────────────────────────────
echo  [1/3] Baixando Metamod:Source para CS2...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$r = try { Invoke-RestMethod 'https://api.github.com/repos/alliedmodders/metamod-source/releases' } catch { $null }; if ($r) { $latest = $r | Where-Object { -not $_.prerelease } | Select-Object -First 1; $a = $latest.assets | Where-Object { $_.name -like '*windows*' -and $_.name -like '*.zip' } | Select-Object -First 1; if ($a) { Invoke-WebRequest $a.browser_download_url -OutFile '%TMP%\metamod.zip' } }"

if not exist "%TMP%\metamod.zip" (
    echo  [..] Tentando mirror alternativo...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest 'https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1313-windows.zip' -OutFile '%TMP%\metamod.zip'" 2>nul
)

if exist "%TMP%\metamod.zip" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TMP%\metamod.zip' -DestinationPath '!CSGO_DIR!' -Force"
    echo  [OK] Metamod extraido.
) else (
    echo  [AVISO] Download falhou. Acesse manualmente:
    echo  https://www.sourcemm.net/downloads.php?branch=master
    echo  Extraia o ZIP em: !CSGO_DIR!
)

:: ── Editar gameinfo.gi ───────────────────────────────────────
echo  [..] Editando gameinfo.gi...

if not exist "!GAMEINFO!" (
    echo  [ERRO] Nao encontrado: !GAMEINFO!
    goto :CSS
)

findstr /c:"addons/metamod" "!GAMEINFO!" >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] gameinfo.gi ja configurado.
    goto :CSS
)

copy "!GAMEINFO!" "!GAMEINFO!.bak" >nul 2>&1
echo  [OK] Backup criado: gameinfo.gi.bak

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-gameinfo.ps1" "!GAMEINFO!"

findstr /c:"addons/metamod" "!GAMEINFO!" >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] gameinfo.gi atualizado!
) else (
    echo.
    echo  =============================================
    echo  [ATENCAO] Adicione MANUALMENTE esta linha
    echo  no arquivo: !GAMEINFO!
    echo.
    echo  Abra o arquivo com o Notepad, encontre o
    echo  bloco SearchPaths { e adicione a primeira
    echo  linha dentro dele:
    echo.
    echo      Game    csgo/addons/metamod
    echo.
    echo  Ficara assim:
    echo      SearchPaths
    echo      {
    echo          Game    csgo/addons/metamod   ^<-- adicione aqui
    echo          Game    csgo
    echo          ...
    echo  =============================================
    echo.
    pause
)

:CSS
echo.
:: ── 2. CounterStrikeSharp ────────────────────────────────────
echo  [2/3] Baixando CounterStrikeSharp...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$r = try { Invoke-RestMethod 'https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases' } catch { $null }; if ($r) { $latest = $r | Where-Object { -not $_.prerelease } | Select-Object -First 1; if (-not $latest) { $latest = $r | Select-Object -First 1 }; $a = $latest.assets | Where-Object { $_.name -like '*with-runtime-windows*' } | Select-Object -First 1; if ($a) { Invoke-WebRequest $a.browser_download_url -OutFile '%TMP%\css.zip'; Write-Host ('[OK] ' + $a.name) } else { Write-Host 'ASSET_NOT_FOUND' } } else { Write-Host 'API_FAIL' }"

if exist "%TMP%\css.zip" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TMP%\css.zip' -DestinationPath '!CSGO_DIR!' -Force"
    echo  [OK] CounterStrikeSharp instalado.
) else (
    echo  [AVISO] Baixe manualmente:
    echo  https://github.com/roflmuffin/CounterStrikeSharp/releases/latest
    echo  Arquivo: counterstrikesharp-with-runtime-windows.zip
    echo  Extraia em: !CSGO_DIR!
    echo.
)

:: ── 3. MatchZy ───────────────────────────────────────────────
echo  [3/3] Baixando MatchZy...
set PLUGINS_DIR=!CSGO_DIR!\addons\counterstrikesharp\plugins\

powershell -NoProfile -ExecutionPolicy Bypass -Command "$r = try { Invoke-RestMethod 'https://api.github.com/repos/shobhit-pathak/MatchZy/releases' } catch { $null }; if ($r) { $latest = $r | Where-Object { -not $_.prerelease } | Select-Object -First 1; if (-not $latest) { $latest = $r | Select-Object -First 1 }; $a = $latest.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1; if ($a) { Invoke-WebRequest $a.browser_download_url -OutFile '%TMP%\matchzy.zip'; Write-Host ('[OK] ' + $a.name) } else { Write-Host 'ASSET_NOT_FOUND' } } else { Write-Host 'API_FAIL' }"

if exist "%TMP%\matchzy.zip" (
    if not exist "!PLUGINS_DIR!" mkdir "!PLUGINS_DIR!"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TMP%\matchzy.zip' -DestinationPath '!PLUGINS_DIR!' -Force"
    echo  [OK] MatchZy instalado.
) else (
    echo  [AVISO] Baixe manualmente:
    echo  https://github.com/shobhit-pathak/MatchZy/releases/latest
    echo  Extraia em: !PLUGINS_DIR!
    echo.
)

:: ── matchzy.cfg ──────────────────────────────────────────────
set CFGDIR=!CSGO_DIR!\cfg\
if not exist "!CFGDIR!" mkdir "!CFGDIR!"
(
    echo // MatchZy - CS2 LAN Manager
    echo matchzy_kick_when_no_match_loaded 0
    echo matchzy_minimum_ready_required 0
    echo matchzy_print_utility_to_chat 1
    echo matchzy_demo_path "demos/"
    echo matchzy_autostart_mode 0
) > "!CFGDIR!matchzy.cfg"
echo  [OK] matchzy.cfg criado.

rmdir /s /q "%TMP%" >nul 2>&1

echo.
echo  =============================================
echo   Pronto! Inicie o CS2 DS e verifique:
echo     css_plugins list
echo     matchzy_status
echo  =============================================
echo.
pause
