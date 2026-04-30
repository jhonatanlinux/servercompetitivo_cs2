@echo off
setlocal enabledelayedexpansion
title CS2 LAN Manager - Backend
color 0A

echo.
echo  CS2 LAN Manager - Backend
echo  =================================
echo.

:: Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js nao encontrado.
    echo  Baixe em: https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: Instalar dependencias se necessario
if not exist "%~dp0backend\node_modules" (
    echo  [..] Instalando dependencias npm...
    cd /d "%~dp0backend"
    call npm install --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo.
        echo  [ERRO] npm install falhou.
        echo  Abra um terminal nesta pasta e rode:
        echo    cd backend
        echo    npm install
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Dependencias instaladas.
) else (
    echo  [OK] Dependencias ok.
)

cd /d "%~dp0backend"

echo.
echo  Iniciando servidor na porta 3001...
echo  Painel: http://localhost:3001

:: Mostrar IP real da maquina
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW=%%a
    set RAW=!RAW: =!
    echo  Rede:   http://!RAW!:3001
)

echo.
echo  Nao feche esta janela enquanto o evento estiver rolando.
echo  =================================
echo.

node server.js
