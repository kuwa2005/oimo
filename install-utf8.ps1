#@build-remove Run `bun script/build-install-ps1.ts` to convert install-utf8.ps1 -> install.ps1 (ASCII-safe)
<#
.SYNOPSIS
    Oimo (OpenCode Mimo Code) installer for Windows.
.DESCRIPTION
    Downloads and installs Oimo (OpenCode Mimo Code) to $env:USERPROFILE\.oimo\bin,
    then adds the directory to the user PATH.
.PARAMETER Version
    Install a specific version (e.g., 0.1.0). Defaults to latest.
    When piping via iex, use $env:VERSION instead.
.PARAMETER NoModifyPath
    Don't modify the user PATH environment variable.
.LINK
    https://github.com/kuwa2005/oimo
.EXAMPLE
    irm https://raw.githubusercontent.com/kuwa2005/oimo/main/install.ps1 | iex
.EXAMPLE
    $env:VERSION = "0.1.0"; irm https://raw.githubusercontent.com/kuwa2005/oimo/main/install.ps1 | iex
#>
param(
    [String] $Version,
    [Switch] $NoModifyPath
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

# Support $env:VERSION for irm | iex usage (param() doesn't receive args via pipeline)
if (-not $Version -and $env:VERSION) { $Version = $env:VERSION }

$IS_EXECUTED_FROM_IEX = ($null -eq $MyInvocation.MyCommand.Path)

function Exit-Install {
    param([Int] $Code = 1)
    if ($IS_EXECUTED_FROM_IEX) {
        $Global:LASTEXITCODE = $Code
        break
    } else {
        exit $Code
    }
}

function Write-Err {
    param([String] $Msg)
    Write-Host $Msg -ForegroundColor Red
    Exit-Install 1
}

# --- Prerequisites ---

if (($PSVersionTable.PSVersion.Major) -lt 5) {
    Write-Err "PowerShell 5 or later is required. Visit https://microsoft.com/powershell"
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Detect architecture ---

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" }
    elseif ([Environment]::Is64BitOperatingSystem) { "x64" }
    else { Write-Err "Oimo requires a 64-bit operating system." }

# AVX2 baseline detection (only relevant for x64)
$NeedsBaseline = $false
if ($Arch -eq "x64") {
    try {
        $code = @"
using System;
using System.Runtime.InteropServices;
public class CpuFeature {
    [DllImport("kernel32.dll")]
    public static extern bool IsProcessorFeaturePresent(int feature);
    public static bool HasAVX2() { return IsProcessorFeaturePresent(40); }
}
"@
        Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue
        if (-not [CpuFeature]::HasAVX2()) { $NeedsBaseline = $true }
    } catch {
        # If detection fails, assume baseline for safety
        $NeedsBaseline = $true
    }
}

$Target = "windows-$Arch"
if ($NeedsBaseline) { $Target = "$Target-baseline" }

# --- Resolve version ---

$Repo = if ($env:GH_REPO) { $env:GH_REPO } else { "kuwa2005/oimo" }
$BaseUrl = if ($env:OIMO_BASE_URL) { $env:OIMO_BASE_URL } else { "https://github.com/$Repo" }

if (-not $Version) {
    try {
        $Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
        $Version = $Release.tag_name.Trim().TrimStart('v')
    } catch {
        Write-Err "Failed to fetch latest version. Check your network and retry, or specify -Version."
    }
} else {
    $Version = $Version.TrimStart('v')
}

# Warn about old versions that don't support oimo upgrade via install.ps1
$MajMin = $Version -replace '^(\d+\.\d+\.\d+).*', '$1'
if ($MajMin -match '^\d+\.\d+\.\d+$') {
    $parts = $MajMin.Split('.')
    $semver = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
    if ($semver -le 104) {
        Write-Host ""
        Write-Host "WARNING: Installing v$Version via install.ps1 will cause 'oimo upgrade' to not function properly." -ForegroundColor Yellow
        Write-Host "This is a known limitation for versions before 0.1.5." -ForegroundColor Yellow
        Write-Host ""
    }
}

# --- Check existing installation ---

$Staging = $false
if ($env:MIMOCODE_INSTALL_DIR) {
    $InstallDir = $env:MIMOCODE_INSTALL_DIR
    $Staging = $true
} else {
    $InstallDir = Join-Path $env:USERPROFILE ".oimo\bin"
}

if (-not $Staging) {
    $Existing = Get-Command oimo -ErrorAction SilentlyContinue
    if ($Existing) {
        $InstalledVersion = & oimo --version 2>$null
        if ($InstalledVersion -eq $Version) {
            Write-Host "Oimo v$Version is already installed." -ForegroundColor DarkGray
            Exit-Install 0
        }
        Write-Host "Installed version: $InstalledVersion" -ForegroundColor DarkGray
    }
}

# --- Download and install ---

$Filename = "oimo-$Target.zip"
$Url = "$BaseUrl/releases/download/v$Version/$Filename"

Write-Host ""
Write-Host "Installing " -NoNewline -ForegroundColor DarkGray
Write-Host "oimo" -NoNewline
Write-Host " version: " -NoNewline -ForegroundColor DarkGray
Write-Host "$Version"

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "oimo_install_$PID"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
$ZipPath = Join-Path $TmpDir $Filename

try {
    $curlExe = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curlExe) {
        & curl.exe -fSL -o $ZipPath $Url
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
    }
} catch {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    Write-Err "Failed to download from $Url`n$($_.Exception.Message)"
}

# Verify checksum when available (existing releases may not ship SHA256SUMS)
$SumsPath = Join-Path $TmpDir "SHA256SUMS"
$SumsUrl = "$BaseUrl/releases/download/v$Version/SHA256SUMS"
try {
    Invoke-WebRequest -Uri $SumsUrl -OutFile $SumsPath -UseBasicParsing -ErrorAction Stop
    $Expected = Get-Content $SumsPath |
        Where-Object { $_ -match "\s$([regex]::Escape($Filename))$" } |
        ForEach-Object { ($_ -split '\s+')[0] } |
        Select-Object -First 1
    if ($Expected) {
        $Actual = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
        if ($Actual -ne $Expected.ToLower()) {
            Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
            Write-Err "Checksum mismatch for $Filename. Expected $Expected, got $Actual."
        }
        Write-Host "Checksum verified (SHA256)." -ForegroundColor DarkGray
    } else {
        Write-Host "WARNING: No checksum entry for $Filename; skipping verification." -ForegroundColor Yellow
    }
} catch {
    Write-Host "WARNING: SHA256SUMS not found for v$Version; skipping checksum verification." -ForegroundColor Yellow
}

# Extract and install
try {
    Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force
} catch {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    Write-Err "Failed to extract archive.`n$($_.Exception.Message)"
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$BinName = if (Test-Path (Join-Path $TmpDir "oimo.exe")) { "oimo.exe" } else { "oimo" }
try {
    Move-Item -Path (Join-Path $TmpDir $BinName) -Destination (Join-Path $InstallDir "oimo.exe") -Force -ErrorAction Stop
} catch {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    Write-Err "Failed to install binary. If Oimo is currently running, please close it and retry.`n$($_.Exception.Message)"
}
Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue

# --- Update PATH ---

if ($Staging) { Exit-Install 0 }

$PathUpdated = $false
if (-not $NoModifyPath) {
    $UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($UserPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable('PATH', "$InstallDir;$UserPath", 'User')
        $env:PATH = "$InstallDir;$env:PATH"
        $PathUpdated = $true
    }
}

# --- Print banner ---

Write-Host ""
function Write-Logo($Left, $Right) {
    Write-Host $Left -NoNewline -ForegroundColor DarkGray; Write-Host $Right
}

$TermWidth = try { $Host.UI.RawUI.WindowSize.Width } catch { 80 }
if ($TermWidth -ge 80) {
    Write-Logo " ██████╗ ██╗███╗   ███╗ ██████╗ " ""
    Write-Logo "██╔═══██╗██║████╗ ████║██╔═══██╗" ""
    Write-Logo "██║   ██║██║██╔████╔██║██║   ██║" ""
    Write-Logo "██║   ██║██║██║╚██╔╝██║██║   ██║" ""
    Write-Logo "╚██████╔╝██║██║ ╚═╝ ██║╚██████╔╝" ""
    Write-Logo " ╚═════╝ ╚═╝╚═╝     ╚═╝ ╚═════╝ " ""
} else {
    Write-Logo "█▀▀█ █ █▀▄▀█ █▀▀█" ""
    Write-Logo "█  █ █ █ ▀ █ █  █" ""
    Write-Logo "▀▀▀▀ ▀ ▀   ▀ ▀▀▀▀" ""
}
Write-Host ""
Write-Host ""

if ($PathUpdated) {
    Write-Host "To get started, open a new terminal and run:" -ForegroundColor DarkGray
    Write-Host "  (VS Code/Cursor users may need to fully restart the editor)" -ForegroundColor DarkGray
} else {
    Write-Host "To get started:" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  cd <project>"
Write-Host "  oimo"
Write-Host ""
Write-Host "For more information visit " -NoNewline -ForegroundColor DarkGray
Write-Host "https://github.com/kuwa2005/oimo"
Write-Host ""
