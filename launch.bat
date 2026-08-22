@echo off
setlocal
cd /d "%~dp0"

set PORT=8080
set URL=http://localhost:%PORT%/

echo.
echo  Adonis Engine
echo  Serving %CD%
echo  %URL%
echo  Close this window to stop the server.
echo.

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  py -m http.server %PORT%
  goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  python -m http.server %PORT%
  goto :eof
)

where npx >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  npx --yes serve -p %PORT%
  goto :eof
)

echo Could not find Python or Node.js.
echo Install Python 3 from https://www.python.org/downloads/
echo (check "Add python.exe to PATH") then run this again.
pause
