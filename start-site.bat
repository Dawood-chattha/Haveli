@echo off
REM ===========================================================================
REM  start-site.bat  --  double-click this to open the site
REM ---------------------------------------------------------------------------
REM  The site cannot be opened straight from index.html. It carries
REM  <base href="/"> so that deep routes such as /category/women/kaftans can
REM  find their CSS and JS; over file:// that "/" points at the drive root
REM  instead, nothing loads, and the page shows bare text.
REM
REM  So this starts the small local server in its own window and then opens
REM  the browser at it. Close that server window to stop the site.
REM ===========================================================================

setlocal
set "URL=http://localhost:8123/"

cd /d "%~dp0"

REM Reuse the server if it is already running, rather than failing on a port
REM that is taken.
call :probe
if not errorlevel 1 (
    echo Server is already running.
    goto :open
)

echo Starting the local server...
start "HAVELI dev server - close this window to stop" powershell -ExecutionPolicy Bypass -NoProfile -File "dev\serve.ps1"

REM Wait until the port actually answers rather than guessing a delay. A
REM fixed pause is both slower than it needs to be and still too short when
REM the previous listener has not released the port yet.
powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"

if errorlevel 1 (
    echo.
    echo The server did not come up. Check the server window for the reason -
    echo the usual one is that port 8123 is still held by an earlier run.
    echo.
    pause
    exit /b 1
)

:open
echo Opening %URL%
start "" "%URL%"
exit /b 0

REM --- returns errorlevel 0 when the site answers, 1 when it does not ---
:probe
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
