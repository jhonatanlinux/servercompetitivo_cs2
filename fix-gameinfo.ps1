# fix-gameinfo.ps1
# Insere a linha do Metamod no gameinfo.gi do CS2
# Uso: powershell -ExecutionPolicy Bypass -File fix-gameinfo.ps1 "caminho\gameinfo.gi"

param([string]$GameInfoPath)

if (-not $GameInfoPath) {
    Write-Host "[ERRO] Informe o caminho do gameinfo.gi como argumento."
    exit 1
}

if (-not (Test-Path $GameInfoPath)) {
    Write-Host "[ERRO] Arquivo nao encontrado: $GameInfoPath"
    exit 1
}

$METAMOD_LINE = "`t`t`tGame`tcsgo/addons/metamod"
$CHECK = "csgo/addons/metamod"

# Verificar se ja existe
$content = Get-Content $GameInfoPath -Raw
if ($content -match [regex]::Escape($CHECK)) {
    Write-Host "[OK] gameinfo.gi ja contem Metamod. Nenhuma alteracao necessaria."
    exit 0
}

# Ler linhas
$lines = [System.IO.File]::ReadAllLines($GameInfoPath)
$output = [System.Collections.Generic.List[string]]::new()

$foundSearchPaths = $false
$inserted = $false

foreach ($line in $lines) {
    $output.Add($line)

    # Detectar linha "SearchPaths" (pode ter aspas ou nao)
    if (-not $inserted -and $line -match '^\s*"?SearchPaths"?\s*$') {
        $foundSearchPaths = $true
        continue
    }

    # Detectar o { que abre o bloco SearchPaths
    if ($foundSearchPaths -and -not $inserted -and $line -match '^\s*\{\s*$') {
        $output.Add($METAMOD_LINE)
        $inserted = $true
        $foundSearchPaths = $false
        continue
    }

    # Reset se encontrou outra coisa antes do {
    if ($foundSearchPaths -and $line -notmatch '^\s*$') {
        $foundSearchPaths = $false
    }
}

if (-not $inserted) {
    Write-Host "[ERRO] Nao foi possivel encontrar o bloco SearchPaths no gameinfo.gi."
    Write-Host "       Adicione manualmente esta linha logo apos a linha { dentro de SearchPaths:"
    Write-Host "       $METAMOD_LINE"
    exit 1
}

# Salvar
[System.IO.File]::WriteAllLines($GameInfoPath, $output, [System.Text.UTF8Encoding]::new($false))
Write-Host "[OK] gameinfo.gi atualizado com sucesso!"
Write-Host "     Linha inserida: $METAMOD_LINE"
exit 0
