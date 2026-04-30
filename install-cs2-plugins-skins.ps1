param(
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Get-Cs2Exe {
    $candidates = @(
        (Join-Path $Root "cs2-ds\game\bin\win64\cs2.exe"),
        "D:\CS2\game\bin\win64\cs2.exe",
        "D:\CS2\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
    }
    throw "cs2.exe nao encontrado. Instale/atualize o CS2 DS primeiro."
}

function Get-LatestReleaseAsset {
    param(
        [string]$Repo,
        [string]$Pattern
    )
    $headers = @{ "User-Agent" = "CS2-LAN-Manager" }
    $releases = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo/releases"
    $release = $releases | Where-Object { -not $_.prerelease } | Select-Object -First 1
    if (-not $release) { $release = $releases | Select-Object -First 1 }
    if (-not $release) { throw "Nenhum release encontrado para $Repo" }
    $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
    if (-not $asset) { throw "Nenhum asset '$Pattern' encontrado para $Repo" }
    return $asset
}

function Download-ReleaseZip {
    param(
        [string]$Repo,
        [string]$Pattern,
        [string]$OutFile
    )
    $asset = Get-LatestReleaseAsset -Repo $Repo -Pattern $Pattern
    Write-Host "Baixando $Repo -> $($asset.name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $OutFile
}

function Download-LatestMetamod2Windows {
    param([string]$OutFile)
    $base = "https://mms.alliedmods.net/mmsdrop/2.0/"
    $page = Invoke-WebRequest -UseBasicParsing $base
    $assets = $page.Links |
        Where-Object { $_.href -match "^mmsource-2\.0\.0-git\d+-windows\.zip$" } |
        Sort-Object { [int]([regex]::Match($_.href, "git(\d+)").Groups[1].Value) } -Descending
    foreach ($asset in $assets) {
        try {
            Write-Host "Baixando Metamod -> $($asset.href)"
            Invoke-WebRequest -UseBasicParsing -Uri ($base + $asset.href) -OutFile $OutFile
            return
        } catch {
            Write-Warning "Snapshot indisponivel ($($asset.href)): $($_.Exception.Message)"
        }
    }
    throw "Nao encontrei snapshot Windows do Metamod 2.0 disponivel para download."
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path $Source)) { return }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Install-ZipPackage {
    param(
        [string]$ZipPath,
        [string]$Name,
        [string]$CsgoDir
    )

    $extractDir = Join-Path $script:TmpDir $Name
    if (Test-Path $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $extractDir -Force

    $addons = Get-ChildItem -Path $extractDir -Directory -Recurse -Filter "addons" | Select-Object -First 1
    if ($addons) {
        Copy-DirectoryContents -Source $addons.FullName -Destination (Join-Path $CsgoDir "addons")
        return
    }

    $gamedata = Get-ChildItem -Path $extractDir -Directory -Recurse -Filter "gamedata" | Select-Object -First 1
    if ($gamedata) {
        Copy-DirectoryContents -Source $gamedata.FullName -Destination (Join-Path $CsgoDir "addons\counterstrikesharp\gamedata")
    }

    $pluginRoot = Join-Path $CsgoDir "addons\counterstrikesharp\plugins"
    New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null

    $dllDirs = Get-ChildItem -Path $extractDir -Recurse -Filter "*.dll" |
        Where-Object { $_.FullName -notmatch "\\runtimes\\" } |
        ForEach-Object { $_.Directory.FullName } |
        Select-Object -Unique

    foreach ($dir in $dllDirs) {
        $folderName = Split-Path $dir -Leaf
        if ($folderName -match "net\d|bin|Release|Debug") {
            $folderName = $Name
        }
        Copy-DirectoryContents -Source $dir -Destination (Join-Path $pluginRoot $folderName)
    }
}

function Enable-MetamodInGameInfo {
    param([string]$GameInfoPath)
    if (-not (Test-Path $GameInfoPath)) { throw "gameinfo.gi nao encontrado: $GameInfoPath" }
    $raw = Get-Content $GameInfoPath -Raw
    if ($raw -match "csgo/addons/metamod") {
        Write-Host "gameinfo.gi ja contem Metamod."
        return
    }
    Copy-Item $GameInfoPath "$GameInfoPath.bak" -Force
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "fix-gameinfo.ps1") $GameInfoPath
}

function Set-CssGuidelinesFlag {
    param([string]$CsgoDir)
    $configDir = Join-Path $CsgoDir "addons\counterstrikesharp\configs"
    $corePath = Join-Path $configDir "core.json"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    if (Test-Path $corePath) {
        try {
            $json = Get-Content $corePath -Raw | ConvertFrom-Json
            $json | Add-Member -NotePropertyName "FollowCS2ServerGuidelines" -NotePropertyValue $false -Force
            $json | ConvertTo-Json -Depth 20 | Set-Content -Path $corePath -Encoding UTF8
        } catch {
            Write-Warning "Nao consegui editar core.json automaticamente: $($_.Exception.Message)"
        }
    } else {
        @{
            FollowCS2ServerGuidelines = $false
        } | ConvertTo-Json -Depth 5 | Set-Content -Path $corePath -Encoding UTF8
    }
}

function Enable-CounterStrikeSharpInMetamod {
    param([string]$CsgoDir)
    $metamodDir = Join-Path $CsgoDir "addons\metamod"
    $metaPlugins = Join-Path $metamodDir "metaplugins.ini"
    $cssLine = "css addons/counterstrikesharp/bin/win64/counterstrikesharp"
    New-Item -ItemType Directory -Force -Path $metamodDir | Out-Null

    $raw = if (Test-Path $metaPlugins) { Get-Content $metaPlugins -Raw } else { "; Metamod plugins`r`n" }
    $raw = $raw -replace "(?m)^\s*;+\s*css\s+addons/counterstrikesharp/bin/win64/counterstrikesharp\s*$", $cssLine
    if ($raw -notmatch [regex]::Escape($cssLine)) {
        $raw = $raw.TrimEnd() + "`r`n$cssLine`r`n"
    }
    Set-Content -Path $metaPlugins -Value $raw -Encoding ASCII

    $cssVdf = Join-Path $metamodDir "counterstrikesharp.vdf"
    if (Test-Path $cssVdf) {
        Move-Item -Path $cssVdf -Destination "$cssVdf.disabled" -Force
    }
}

function Disable-CounterStrikeSharpVdf {
    param([string]$CsgoDir)
    $cssVdf = Join-Path $CsgoDir "addons\metamod\counterstrikesharp.vdf"
    if (Test-Path $cssVdf) {
        Move-Item -Path $cssVdf -Destination "$cssVdf.disabled" -Force
    }
}

function Write-MatchZyConfig {
    param([string]$CsgoDir)
    $cfgDir = Join-Path $CsgoDir "cfg"
    New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
    @"
// MatchZy - CS2 LAN Manager
matchzy_kick_when_no_match_loaded 0
matchzy_minimum_ready_required 0
matchzy_print_utility_to_chat 1
matchzy_demo_path "demos/"
matchzy_autostart_mode 0
"@ | Set-Content -Path (Join-Path $cfgDir "matchzy.cfg") -Encoding ASCII
}

Write-Step "Preparando servidor"
$cs2Exe = Get-Cs2Exe
$gameDir = Resolve-Path (Join-Path (Split-Path $cs2Exe -Parent) "..\..")
$csgoDir = Join-Path $gameDir "csgo"
$gameInfo = Join-Path $csgoDir "gameinfo.gi"
$script:TmpDir = Join-Path $Root "plugins-tmp"

Write-Host "CS2 EXE: $cs2Exe"
Write-Host "CSGO DIR: $csgoDir"

Get-Process cs2 -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith((Join-Path $Root "cs2-ds"), [StringComparison]::OrdinalIgnoreCase)
} | Stop-Process -Force

if (Test-Path $script:TmpDir) { Remove-Item -LiteralPath $script:TmpDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $script:TmpDir | Out-Null

try {
    Write-Step "Baixando Metamod 2.0 para CS2"
    $metamodZip = Join-Path $script:TmpDir "metamod.zip"
    Download-LatestMetamod2Windows -OutFile $metamodZip
    Install-ZipPackage -ZipPath $metamodZip -Name "Metamod" -CsgoDir $csgoDir
    Enable-MetamodInGameInfo -GameInfoPath $gameInfo

    Write-Step "Baixando CounterStrikeSharp"
    $cssZip = Join-Path $script:TmpDir "counterstrikesharp.zip"
    Download-ReleaseZip -Repo "roflmuffin/CounterStrikeSharp" -Pattern "with-runtime-windows.*\.zip$" -OutFile $cssZip
    Install-ZipPackage -ZipPath $cssZip -Name "CounterStrikeSharp" -CsgoDir $csgoDir
    Enable-CounterStrikeSharpInMetamod -CsgoDir $csgoDir

    Write-Step "Baixando MatchZy"
    $matchzyZip = Join-Path $script:TmpDir "matchzy.zip"
    Download-ReleaseZip -Repo "shobhit-pathak/MatchZy" -Pattern "with-cssharp-windows.*\.zip$" -OutFile $matchzyZip
    Install-ZipPackage -ZipPath $matchzyZip -Name "MatchZy" -CsgoDir $csgoDir
    Write-MatchZyConfig -CsgoDir $csgoDir

    Write-Step "Baixando dependencias do WeaponPaints"
    $deps = @(
        @{ Repo = "NickFox007/AnyBaseLibCS2"; Name = "AnyBaseLibCS2" },
        @{ Repo = "NickFox007/PlayerSettingsCS2"; Name = "PlayerSettingsCS2" },
        @{ Repo = "NickFox007/MenuManagerCS2"; Name = "MenuManagerCS2" }
    )
    foreach ($dep in $deps) {
        $zip = Join-Path $script:TmpDir "$($dep.Name).zip"
        Download-ReleaseZip -Repo $dep.Repo -Pattern "\.zip$" -OutFile $zip
        Install-ZipPackage -ZipPath $zip -Name $dep.Name -CsgoDir $csgoDir
    }

    Write-Step "Baixando WeaponPaints"
    $weaponPaintsZip = Join-Path $script:TmpDir "WeaponPaints.zip"
    Download-ReleaseZip -Repo "Nereziel/cs2-WeaponPaints" -Pattern "^WeaponPaints\.zip$" -OutFile $weaponPaintsZip
    Install-ZipPackage -ZipPath $weaponPaintsZip -Name "WeaponPaints" -CsgoDir $csgoDir
    Set-CssGuidelinesFlag -CsgoDir $csgoDir
    Disable-CounterStrikeSharpVdf -CsgoDir $csgoDir

    Write-Step "Pronto"
    Write-Host "Instalacao concluida."
    Write-Host ""
    Write-Host "IMPORTANTE:"
    Write-Host "1. Inicie o servidor Mix com skins uma vez para gerar WeaponPaints.json."
    Write-Host "2. Configure MySQL em:"
    Write-Host "   $csgoDir\addons\counterstrikesharp\configs\plugins\WeaponPaints\WeaponPaints.json"
    Write-Host "3. Depois reinicie o servidor e teste: css_plugins list, !knife, !gloves, !agents."
} finally {
    if (Test-Path $script:TmpDir) {
        Remove-Item -LiteralPath $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
