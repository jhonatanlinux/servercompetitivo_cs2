@echo off
setlocal
title MariaDB CS2 Skins
color 0B

set MARIADB_DIR=%~dp0mariadb
set DATA_DIR=%~dp0mariadb-data

if not exist "%MARIADB_DIR%\bin\mariadbd.exe" (
    echo [ERRO] MariaDB nao encontrado em %MARIADB_DIR%
    pause
    exit /b 1
)

tasklist /FI "IMAGENAME eq mariadbd.exe" | find /I "mariadbd.exe" >nul
if %errorlevel% equ 0 (
    echo [OK] MariaDB ja esta rodando.
    exit /b 0
)

echo [..] Iniciando MariaDB para WeaponPaints...
start "MariaDB CS2 Skins" /min "%MARIADB_DIR%\bin\mariadbd.exe" --datadir="%DATA_DIR%" --port=3306 --bind-address=127.0.0.1 --console
timeout /t 4 /nobreak >nul
echo [OK] MariaDB iniciado.
