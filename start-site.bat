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
REM  LAUNCHING NODE TOOK THREE TRIES; HERE IS WHY THIS ONE.
REM
REM  Node lives at C:\Program Files\nodejs\node.exe, and that space is the
REM  whole difficulty. `start "title" cmd /c "node ... & pause"` had its
REM  quoting eaten by the outer shell and never ran at all. `cmd /k "%NODE%"
REM  args` fared no better: cmd strips the quotes around the first token in
REM  its own way, so the path broke at "Program", the window closed instantly,
REM  and this script reported that port 3000 was busy - which it was not.
REM
REM  PowerShell's Start-Process takes the executable and its arguments as
REM  separate values, so there is no line for a shell to re-parse and no
REM  quoting to get wrong. It also gives the server its own console window,
REM  which is what the user closes to stop the site.
powershell -NoProfile -Command "Start-Process -FilePath '%NODE%' -ArgumentList '--env-file=.env.local','dev\server.mjs' -WorkingDirectory '%CD%'"

REM  Wait until the port actually answers rather than guessing a delay. A
REM  fixed pause is both slower than it needs to be and still too short when
REM  the previous listener has not released the port yet.
REM
REM  This was one long PowerShell one-liner holding its own retry loop, and it
REM  reported failure while the server was in fact up and answering. Rather
REM  than work out which part of a line with nested quotes, semicolons and
REM  two exit codes was misbehaving, it is now an ordinary batch loop calling
REM  the same :probe this file already used above. Fewer languages in one
REM  line, and the retry is visible.

set /a TRIES=0

:wait
call :probe
if not errorlevel 1 goto :open

set /a TRIES+=1
if %TRIES% GEQ 20 goto :failed

REM `timeout` is a Windows command, so this costs no new process launch of
REM anything heavier. /nobreak stops a stray keypress cutting it short.
timeout /t 1 /nobreak >nul
goto :wait

:failed
echo.
echo The server did not come up.
echo.
echo A second window should have opened with the reason in it. If it
echo closed too fast, run this by hand to see the error:
echo.
echo    node --env-file=.env.local dev\server.mjs
echo.
pause
exit /b 1

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
