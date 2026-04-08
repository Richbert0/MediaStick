@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title MediaCenter v2.0
cd /d "%~dp0app"

call :BANNER
goto INIT

:BANNER
cls
color 0E
echo.
echo  +============================================================+
echo  ^|                                                            ^|
echo  ^|        M E D I A C E N T E R   v 2 . 0                    ^|
echo  ^|        Electron-Ready Portable Edition                     ^|
echo  ^|                                                            ^|
echo  +============================================================+
color 0A
echo.
exit /b

:INIT
:: Python suchen
set PYTHON=
for %%C in (python python3 py) do (
    if not defined PYTHON (
        %%C --version >nul 2>&1 && set PYTHON=%%C
    )
)
if not defined PYTHON (
    color 0C
    echo  [FEHLER] Python nicht gefunden!
    echo  Bitte installieren: https://python.org/downloads
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%V in ('!PYTHON! --version 2^>^&1') do echo  Python: %%V

if not exist "%~dp0app\server.py" (
    color 0C
    echo  [FEHLER] server.py nicht gefunden in: %~dp0app
    pause & exit /b 1
)

goto START_SERVER

:START_SERVER
:: Pruefen ob Server bereits laeuft
set _RUNNING=0
if exist "%~dp0app\server.pid" (
    set /p SPID=<"%~dp0app\server.pid" 2>nul
    if defined SPID (
        tasklist /FI "PID eq !SPID!" 2>nul | findstr /I "python" >nul 2>&1
        if not errorlevel 1 set _RUNNING=1
    )
)
if !_RUNNING!==1 (
    set SV_PORT=8080
    if exist "%~dp0app\server.port" set /p SV_PORT=<"%~dp0app\server.port" 2>nul
    echo  Server laeuft bereits auf Port !SV_PORT!
    goto READY
)

:: Alte Prozesse beenden
set SV_PORT=8080
if exist "%~dp0app\server.port" set /p SV_PORT=<"%~dp0app\server.port" 2>nul
if exist "%~dp0app\server.pid" (
    set /p SPID=<"%~dp0app\server.pid" 2>nul
    if defined SPID taskkill /F /PID !SPID! >nul 2>&1
)
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do taskkill /F /PID %%P >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8765 "') do taskkill /F /PID %%P >nul 2>&1
wmic process where "commandline like '%%server.py%%'" delete >nul 2>&1

:: Port/PID-Dateien loeschen
del "%~dp0app\server.pid"  >nul 2>&1
del "%~dp0app\server.port" >nul 2>&1

:: Log rotieren
if exist "%~dp0app\server.log" (
    move /Y "%~dp0app\server.log" "%~dp0app\server.log.bak" >nul 2>&1
)

echo  Starte MediaCenter Server...

:: HTTP-Server starten
start "" /B cmd /c "!PYTHON! "%~dp0app\server.py" >> "%~dp0app\server.log" 2>&1"

:: Node.js Multiplayer-Server starten (falls verfuegbar)
netstat -ano 2>nul | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    where node >nul 2>&1
    if not errorlevel 1 (
        if exist "%~dp0app\games\server.js" (
            start "" /B cmd /c "cd /d "%~dp0app\games" && node server.js >> "%~dp0app\games\server-ws.log" 2>&1"
            echo  Multiplayer-Server ^(Node.js^) gestartet auf Port 8765
        )
    ) else (
        echo  WARNUNG: Node.js nicht gefunden - Multiplayer nicht verfuegbar
    )
) else (
    echo  Multiplayer-Server laeuft bereits auf Port 8765
)

:: Warten bis server.port geschrieben (max 18s)
set SV_PORT=8080
set /a _WP=0
:WAIT_PORT
if exist "%~dp0app\server.port" goto PORT_READY
if !_WP! geq 18 goto WAIT_HTTP
timeout /t 1 /nobreak >nul
set /a _WP+=1
goto WAIT_PORT
:PORT_READY
set /p SV_PORT=<"%~dp0app\server.port" 2>nul

:: Warten bis HTTP-Port offen (max 15s)
:WAIT_HTTP
set /a _WH=0
:WAIT_HTTP_LOOP
netstat -ano 2>nul | findstr ":!SV_PORT! " >nul 2>&1
if not errorlevel 1 goto HTTP_READY
if !_WH! geq 15 goto HTTP_READY
timeout /t 1 /nobreak >nul
set /a _WH+=1
goto WAIT_HTTP_LOOP

:HTTP_READY
:: PID sichern
if not exist "%~dp0app\server.pid" (
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do (
        echo %%P>"%~dp0app\server.pid"
        goto :PID_DONE
    )
)
:PID_DONE

:: Browser oeffnen (PWA oder Standard)
call :OPEN_BROWSER http://localhost:!SV_PORT!

:READY
call :BANNER
set SV_PORT=8080
if exist "%~dp0app\server.port" set /p SV_PORT=<"%~dp0app\server.port" 2>nul

:: Mediathek zaehlen
set M_F=0 & set M_S=0 & set M_M=0 & set M_I=0
for /r "%~dp0app\media\Movies" %%F in (*.mp4 *.mkv *.avi *.mov *.webm *.wmv *.m4v) do set /a M_F+=1
for /r "%~dp0app\media\Series" %%F in (*.mp4 *.mkv *.avi *.mov *.webm *.wmv *.m4v) do set /a M_S+=1
for /r "%~dp0app\media\Music"  %%F in (*.mp3 *.flac *.m4a *.aac *.ogg *.wav)       do set /a M_M+=1
for /r "%~dp0app\media\Images" %%F in (*.jpg *.jpeg *.png *.gif *.webp *.bmp)       do set /a M_I+=1

:: Server-Status pruefen
netstat -ano 2>nul | findstr ":!SV_PORT! " >nul 2>&1
if errorlevel 1 (set HST=INAKTIV) else (set HST=AKTIV  )
netstat -ano 2>nul | findstr ":8765 " >nul 2>&1
if errorlevel 1 (set WST=INAKTIV) else (set WST=AKTIV  )

echo  +============================================================+
echo  ^|  HTTP-Server     Port !SV_PORT!    [ !HST! ]                     ^|
echo  ^|  WS-Multiplayer  Port 8765    [ !WST! ]                     ^|
echo  ^|  URL: http://localhost:!SV_PORT!/                               ^|
echo  +------------------------------------------------------------+
echo  ^|  Filme: !M_F!   Serien-Eps: !M_S!   Musik: !M_M!   Fotos: !M_I!              ^|
echo  +------------------------------------------------------------+
echo  ^|  Befehle: browser  info  log  folder  stop  help          ^|
echo  +============================================================+
echo.

:LOOP
set CMD=
set /p CMD=  ^> 
if /i "!CMD!"=="stop"    goto DO_STOP
if /i "!CMD!"=="info"    goto DO_INFO
if /i "!CMD!"=="folder"  goto DO_FOLDER
if /i "!CMD!"=="browser" goto DO_BROWSER
if /i "!CMD!"=="log"     goto DO_LOG
if /i "!CMD!"=="help"    goto DO_HELP
if /i "!CMD!"=="exit"    goto DO_STOP
if /i "!CMD!"=="quit"    goto DO_STOP
if "!CMD!"==""           goto LOOP
echo  Unbekannt: "!CMD!"  (help fuer Hilfe)
goto LOOP

:DO_STOP
echo  Beende Dienste...
if exist "%~dp0app\server.pid" (
    set /p SPID=<"%~dp0app\server.pid"
    if defined SPID taskkill /F /PID !SPID! >nul 2>&1
    del "%~dp0app\server.pid" >nul 2>&1
)
wmic process where "commandline like '%%server.py%%'" delete >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8765 "') do taskkill /F /PID %%P >nul 2>&1
wmic process where "commandline like '%%games\\server.js%%'" delete >nul 2>&1
if exist "%~dp0app\server.port" (
    set /p SV_PORT=<"%~dp0app\server.port" 2>nul
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do taskkill /F /PID %%P >nul 2>&1
)
del "%~dp0app\server.port" >nul 2>&1
color 0C
echo  +============================================================+
echo  ^|  MediaCenter gestoppt.   start = neu   x = beenden        ^|
echo  +============================================================+
color 0A
:STOP_LOOP
set CMD=
set /p CMD=  ^> 
if /i "!CMD!"=="start" goto DO_RESTART
if /i "!CMD!"=="x"    exit /b 0
if /i "!CMD!"=="exit" exit /b 0
echo  "start" oder "x" eingeben.
goto STOP_LOOP
:DO_RESTART
call :BANNER
goto START_SERVER

:DO_INFO
set SV_PORT=8080
if exist "%~dp0app\server.port" set /p SV_PORT=<"%~dp0app\server.port" 2>nul
netstat -ano 2>nul | findstr ":!SV_PORT! " >nul 2>&1
if errorlevel 1 (set HST=INAKTIV) else (set HST=AKTIV  )
netstat -ano 2>nul | findstr ":8765 " >nul 2>&1
if errorlevel 1 (set WST=INAKTIV) else (set WST=AKTIV  )
echo  +============================================================+
echo  ^|  HTTP Port !SV_PORT! [!HST!]   WS Port 8765 [!WST!]           ^|
echo  +============================================================+
goto LOOP

:DO_LOG
echo  --- SERVER LOG (letzte 25 Zeilen) ---
if exist "%~dp0app\server.log" (
    powershell -command "Get-Content '%~dp0app\server.log' -Tail 25" 2>nul || type "%~dp0app\server.log"
) else (
    echo  Keine Logdatei vorhanden.
)
goto LOOP

:DO_FOLDER
echo  +============================================================+
echo  ^|  Filme:   app\media\Movies                                ^|
echo  ^|  Serien:  app\media\Series                                ^|
echo  ^|  Musik:   app\media\Music                                 ^|
echo  ^|  Fotos:   app\media\Images                                ^|
echo  ^|  Spiele:  app\games\solo  /  app\games\multi              ^|
echo  +============================================================+
echo  Pfad: %~dp0
goto LOOP

:DO_BROWSER
set SV_PORT=8080
if exist "%~dp0app\server.port" set /p SV_PORT=<"%~dp0app\server.port" 2>nul
call :OPEN_BROWSER http://localhost:!SV_PORT!
goto LOOP

:DO_HELP
echo  +============================================================+
echo  ^|  browser  - Browser oeffnen                               ^|
echo  ^|  info     - Server-Status                                 ^|
echo  ^|  log      - Server-Log anzeigen                           ^|
echo  ^|  folder   - Medien-Ordner                                 ^|
echo  ^|  stop     - Server anhalten                               ^|
echo  ^|  help     - Diese Hilfe                                   ^|
echo  +============================================================+
goto LOOP

:OPEN_BROWSER
set _URL=%~1
:: Edge App-Modus
set _EDGE=
for %%P in ("%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
    if not defined _EDGE if exist %%P set _EDGE=%%~P
)
if defined _EDGE (start "" "!_EDGE!" --app=%_URL% --window-size=1400,900 & exit /b 0)
:: Chrome App-Modus
set _CHROME=
for %%P in ("%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe") do (
    if not defined _CHROME if exist %%P set _CHROME=%%~P
)
if defined _CHROME (start "" "!_CHROME!" --app=%_URL% --window-size=1400,900 & exit /b 0)
:: Fallback Standard-Browser
start %_URL%
exit /b 0
