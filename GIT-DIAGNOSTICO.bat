@echo off
REM ============================================================
REM   GIT-DIAGNOSTICO.bat - versao com log e pause forte
REM   Roda tudo, grava log em git-log.txt, NAO fecha sozinho.
REM ============================================================

setlocal
cd /d "%~dp0"
set "LOG=%~dp0git-log.txt"

echo === %date% %time% === > "%LOG%"
echo ============================================================
echo  Tudo sera gravado em: %LOG%
echo ============================================================
echo.

echo --- git --version ---
echo --- git --version --- >> "%LOG%"
git --version
git --version >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo *** GIT NAO INSTALADO. Baixe em https://git-scm.com/download/win
  echo *** GIT NAO INSTALADO >> "%LOG%"
  goto :pausa
)

echo.
echo --- git init -b main ---
echo --- git init -b main --- >> "%LOG%"
git init -b main
git init -b main >> "%LOG%" 2>&1

echo.
echo --- config user ---
echo --- config user --- >> "%LOG%"
git config user.email "jhonatan-135@hotmail.com.br"
git config user.name "Jhonatan"
git config user.email "jhonatan-135@hotmail.com.br" >> "%LOG%" 2>&1
git config user.name "Jhonatan" >> "%LOG%" 2>&1

echo.
echo --- git add -A ---
echo --- git add -A --- >> "%LOG%"
git add -A
git add -A >> "%LOG%" 2>&1

echo.
echo --- git status --short (50 primeiras linhas) ---
echo --- git status --- >> "%LOG%"
git status --short
git status --short >> "%LOG%"

echo.
echo --- git commit ---
echo --- git commit --- >> "%LOG%"
git commit -m "MT PRO LEAGUE CS2 Manager - initial commit"
git commit -m "MT PRO LEAGUE CS2 Manager - initial commit" >> "%LOG%" 2>&1

echo.
echo --- git remote ---
echo --- git remote --- >> "%LOG%"
git remote remove origin >nul 2>&1
git remote add origin https://github.com/jhonatanlinux/servercompetitivo_cs2.git
git remote -v
git remote -v >> "%LOG%" 2>&1

echo.
echo ============================================================
echo  PUSH agora. Vai pedir login do GitHub:
echo    Usuario:  jhonatanlinux
echo    Senha:    Personal Access Token (NAO eh a senha do github)
echo    Cria em https://github.com/settings/tokens (escopo: repo)
echo ============================================================
echo.
echo --- git push --- >> "%LOG%"
git push -u origin main
git push -u origin main >> "%LOG%" 2>&1

if errorlevel 1 (
  echo.
  echo *** PUSH FALHOU. Escolha:
  echo *** PUSH FALHOU >> "%LOG%"
  echo   A^) git pull --rebase origin main ^&^& git push -u origin main
  echo   B^) git push -u origin main --force
  echo   C^) Verifique o token em https://github.com/settings/tokens
)

:pausa
echo.
echo === Fim %date% %time% === >> "%LOG%"
echo ============================================================
echo  Log salvo em:  %LOG%
echo  Se deu erro, manda esse arquivo aqui no chat.
echo ============================================================
echo.
echo Pressione ENTER para fechar...
pause >nul
endlocal
