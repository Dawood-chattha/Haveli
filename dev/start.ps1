# =============================================================================
# dev/start.ps1 — start the site and open it
# -----------------------------------------------------------------------------
# start-site.bat is now three lines that call this. Everything the launcher
# does lives here instead, and the reason is that the batch version kept
# failing in ways that had nothing to do with the site.
#
# WHAT WENT WRONG IN THE BATCH FILE, TWICE
#
#   Quoting.  node.exe sits under "C:\Program Files", and passing that path
#             through `start` and `cmd /c` meant two shells re-parsing one
#             line. It broke at "Program" and the server window closed before
#             anyone could read the error.
#
#   `timeout`. Git for Windows puts its Unix tools on PATH, so `timeout /t 1`
#             in a batch file can reach coreutils' timeout instead of the
#             Windows one, which answers "invalid time interval '/t'" and
#             spins the retry loop into nonsense. Which one runs depends on
#             how Git was installed - so it worked on one machine and not
#             another, which is the worst kind of bug to chase.
#
# PowerShell has real values, real error handling and Start-Sleep. There is no
# second shell to re-parse anything.
# =============================================================================

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Port = 3000
$Url  = "http://localhost:$Port/"

Set-Location $Root

function Test-Site {
    try {
        # 127.0.0.1 rather than localhost: the server binds to IPv4 only, and
        # on some machines "localhost" is tried as ::1 first and fails.
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

# --- Already running? -------------------------------------------------------

if (Test-Site) {
    Write-Host "Server is already running."
    Start-Process $Url
    exit 0
}

# --- Find Node --------------------------------------------------------------
# `where node` alone is not enough. Installing Node adds it to PATH, but a
# window opened before the install keeps the environment it started with, so
# the command insists Node is missing on a machine where it plainly is not.

$Node = $null
$fromPath = Get-Command node -ErrorAction SilentlyContinue
if ($fromPath) { $Node = $fromPath.Source }

if (-not $Node) {
    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )) {
        if (Test-Path $candidate) { $Node = $candidate; break }
    }
}

if (-not $Node) {
    Write-Host ""
    Write-Host "Node.js was not found, and the site's API needs it."
    Write-Host ""
    Write-Host "Install it with:   winget install OpenJS.NodeJS.LTS"
    Write-Host "Then run this again."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

# --- Configuration ----------------------------------------------------------

if (-not (Test-Path (Join-Path $Root '.env.local'))) {
    Write-Host ""
    Write-Host ".env.local is missing, so the server has no database to talk to."
    Write-Host ""
    Write-Host "Copy .env.example to .env.local and fill in the three Supabase"
    Write-Host "values, then run this again."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

# --- Start it ---------------------------------------------------------------
# Start-Process takes the executable and its arguments as separate values, so
# there is no command line for another shell to re-parse. The server gets its
# own window, which is what gets closed to stop the site.

Write-Host "Starting the local server..."

Start-Process -FilePath $Node `
              -ArgumentList '--env-file=.env.local', 'dev\server.mjs' `
              -WorkingDirectory $Root

# --- Wait for it to answer --------------------------------------------------
# Polling the port rather than pausing a fixed time: a guess is both slower
# than it needs to be and still too short when the previous listener has not
# released the port yet.

$deadline = (Get-Date).AddSeconds(25)

while ((Get-Date) -lt $deadline) {
    if (Test-Site) {
        Write-Host ""
        Write-Host "  storefront   $Url"
        Write-Host "  owner panel  ${Url}admin"
        Write-Host ""
        Start-Process $Url
        exit 0
    }
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "The server did not come up within 25 seconds."
Write-Host ""
Write-Host "A second window should have opened with the reason in it. If it"
Write-Host "closed too fast, run this by hand to see the error:"
Write-Host ""
Write-Host "    node --env-file=.env.local dev\server.mjs"
Write-Host ""
Read-Host "Press Enter to close"
exit 1
