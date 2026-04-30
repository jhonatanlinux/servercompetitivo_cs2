@echo off
REM ============================================================
REM   GIT-INICIAR.bat
REM   Inicializa repo, faz primeiro commit e push para
REM   https://github.com/jhonatanlinux/servercompetitivo_cs2
REM ============================================================

setlocal
cd /d "%~dp0"

set "REMOTE_URL=https://github.com/jhonatanlinux/servercompetitivo_cs2.git"
set "BRANCH=main"

echo.
echo === Verificando git instalado ===
git --version
if errorlevel 1 (
  echo.
  echo Git nao encontrado. Instale em https://git-scm.com/download/win e rode de novo.
  pause
  exit /b 1
)

echo.
echo === git init (branch %BRANCH%) ===
if exist ".git" (
  echo .git ja existe. Pulando init.
) else (
  git init -b %BRANCH%
)

echo.
echo === Configurando autor (apenas neste repo) ===
git config user.email "jhonatan-135@hotmail.com.br"
git config user.name  "Jhonatan"

echo.
echo === Verificando .gitignore e README ===
if not exist ".gitignore" (
  echo ERRO: .gitignore nao existe. Abortando.
  pause
  exit /b 1
)
if not exist "README.md" (
  echo ERRO: README.md nao existe. Abortando.
  pause
  exit /b 1
)

echo.
echo === git add . ===
git add -A

echo.
echo === Resumo do que vai pro commit ===
git status --short
for /f %%C in ('git status --short ^| find /c /v ""') do echo   Total de arquivos: %%C

echo.
echo === Commit inicial ===
git commit -m "MT PRO LEAGUE CS2 Manager - initial commit"
if errorlevel 1 (
  echo.
  echo Aviso: nao houve nada para commitar (talvez ja exista commit anterior). Continuando...
)

echo.
echo === Adicionando remote 'origin' ===
git remote remove origin >nul 2>&1
git remote add origin %REMOTE_URL%
git remote -v

echo.
echo === Tentando push ===
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  Push rejeitado.
  echo.
  echo  Possiveis causas:
  echo    1. O repo no GitHub ja tem commits ^(README inicial, etc.^).
  echo       Resolva com:
  echo          git pull --rebase origin %BRANCH%
  echo          git push -u origin %BRANCH%
  echo.
  echo    2. Autenticacao falhou.
  echo       Use Personal Access Token como senha:
  echo       GitHub -^> Settings -^> Developer settings -^>
  echo       Personal access tokens -^> Generate new token (escopo repo)
  echo.
  echo    3. Quer forcar (sobrescreve o que esta no GitHub):
  echo          git push -u origin %BRANCH% --force
  echo ============================================================
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  PUSH OK! Verifique em:
echo  %REMOTE_URL%
echo ============================================================
pause
