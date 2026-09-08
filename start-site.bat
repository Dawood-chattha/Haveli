@echo off
REM ===========================================================================
REM  start-site.bat  --  double-click this to open the site
REM ---------------------------------------------------------------------------
REM  The site cannot be opened straight from index.html. It carries
REM  <base href="/"> so that deep routes such as /category/women/kaftans can
REM  find their CSS and JS; over file:// that "/" points at the drive root
REM  instead, nothing loads, and the page shows bare text.
REM
REM  WHY THIS FILE IS THREE LINES
REM  It used to do the work itself: find Node, launch it, poll the port, open
REM  the browser. Every one of those steps broke in a way that had nothing to
REM  do with the site - a path with a space re-parsed by two shells, and a
REM  `timeout /t` that reached Git's Unix timeout instead of Windows' and
REM  spun the wait loop into nonsense. Which of those happens depends on the
REM  machine, so it worked here and failed there.
REM
REM  dev\start.ps1 does the whole thing in one language, with real values and
REM  real error handling. This file only launches it.
REM
REM  -ExecutionPolicy Bypass applies to this one process and changes nothing
REM  about the machine's own policy.
REM ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev\start.ps1"
