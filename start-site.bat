@echo off
REM ===========================================================================
REM  start-site.bat  --  double-click this to open the site
REM ---------------------------------------------------------------------------
REM  The site cannot be opened straight from index.html. It carries
REM  <base href="/"> so that deep routes such as /category/women/kaftans can
REM  find their CSS and JS; over file:// that "/" points at the drive root
REM  instead, nothing loads, and the page shows bare text.
REM
REM  So this starts the local server in its own window and then opens the
REM  browser at it. Close that server window to stop the site.
REM
REM  WHY THIS CHANGED IN PHASE 3
REM  It used to start dev\serve.ps1 on port 8123, which serves files and
REM  nothing else. That was the whole site until a backend existed. It is not
REM  any more: signing in, and everything built on top of it, needs /api, and
REM  on that server /api/auth/login quietly returns index.html. The sign-in
REM  form then fails with no obvious reason, which is exactly what happened
REM  and took a while to find.
REM
REM  dev\server.mjs serves the same files AND runs the API, so there is now
REM  one server and no way to be on the wrong one by accident.
REM
REM  serve.ps1 is still there and still works for looking at the storefront
REM  with no backend. It is not what this opens.
REM ===========================================================================

setlocal
set "URL=http://localhost:3000/"

cd /d "%~dp0"

REM --- Find Node -------------------------------------------------------------
REM  `where node` alone is not enough, and the reason is worth writing down.
REM  Installing Node adds its folder to PATH, but a process that was already
REM  running keeps the environment it started with -- and so does everything it
REM  launches. An Explorer window, or a terminal, opened before the install has
REM  a PATH with no Node in it, and this file inherits that. The result is a
REM  script insisting Node is missing on a machine where it plainly is not.
REM
REM  So: try PATH first, and fall back to the two places the installer actually
REM  puts it. Only give up when the file is not on disk at all.
REM ---------------------------------------------------------------------------

set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"

if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
    echo.
    echo Node.js was not found, and the site's API needs it.
    echo.
    echo Install it with:   winget install OpenJS.NodeJS.LTS
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)

REM --- The API cannot start without its configuration. ---
if not exist ".env.local" (
    echo.
    echo .env.local is missing, so the server has no database to talk to.
    echo.
    echo Copy .env.example to .env.local and fill in the three Supabase
    echo values, then run this file again.
    echo.
    pause
    exit /b 1
)

REM Reuse the server if it is already running, rather than failing on a port
REM that is taken.
call :probe
if not errorlevel 1 (
    echo Server is already running.
    goto :open
)

echo Starting the local server...
REM `cmd /k` rather than `cmd /c "... & pause"`: the quoting in that form is
REM parsed by the outer shell before cmd sees it, and the command silently
REM never ran. /k keeps the window open on its own, so a startup error stays
REM on screen instead of flashing past.
start "HAVELI dev server - close this window to stop" cmd /k "%NODE%" --env-file=.env.local dev\server.mjs

REM Wait until the port actually answers rather than guessing a delay. A
REM fixed pause is both slower than it needs to be and still too short when
REM the previous listener has not released the port yet.
powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"

if errorlevel 1 (
    echo.
    echo The server did not come up. Check the server window for the reason -
    echo the usual one is that port 3000 is still held by an earlier run.
    echo.
    pause
    exit /b 1
)

:open
echo Opening %URL%
echo   storefront   %URL%
echo   owner panel  %URL%admin
start "" "%URL%"
exit /b 0

REM --- returns errorlevel 0 when the site answers, 1 when it does not ---
:probe
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
