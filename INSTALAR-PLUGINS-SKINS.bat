@echo off
setlocal
title CS2 Plugins + Skins
color 0B

echo.
echo  =============================================
echo   Instalar plugins CS2
echo   Metamod + CounterStrikeSharp + MatchZy
echo   WeaponPaints + dependencias
echo  =============================================
echo.
echo  Feche o servidor antes de continuar.
echo  O plugin de skins WeaponPaints exige MySQL.
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-cs2-plugins-skins.ps1"

echo.
pause
