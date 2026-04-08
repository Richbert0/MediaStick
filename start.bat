@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title MediaCenter v2.1

rem ============================================================
rem  Konfiguration
rem ============================================================
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "UPDATE_DIR=%ROOT_DIR%update"
set "APP_VERSION=2.1"
set "AUTO_UPDATE=1"
set "RESTART_REQUIRED=0"

rem Erst Updates pruefen und installieren, dann normal starten
call :CHECK_UPDATES
if /i "!RESTART_REQUIRED!"=="1" (
    echo.
    echo  Neustart nach Update...
    timeout /t 2 /nobreak >nul
    start "" "%~f0"
    exit /b 0
)

rem Abhaengigkeiten installieren / pruefen
call :INSTALL_DEPENDENCIES
if errorlevel 1 exit /b 1

cd /d "!APP_DIR!" || (
    color 0C
    echo  [FEHLER] App-Ordner nicht gefunden: "!APP_DIR!"
    pause
    exit /b 1
)

call :BANNER
goto INIT


:BANNER
cls
color 0E
echo.
echo  +============================================================+
echo  ^|                                                            ^|
echo  ^|        M E D I A C E N T E R   v %APP_VERSION%                    ^|
echo  ^|        Electron-Ready Portable Edition                     ^|
echo  ^|                                                            ^|
echo  +============================================================+
color 0A
echo.
exit /b


:CHECK_UPDATES
if /i not "%AUTO_UPDATE%"=="1" exit /b 0

set "UPDATE_FOUND=0"
set "UPDATE_VERSION="

if exist "%UPDATE_DIR%\version.txt" (
    set /p UPDATE_VERSION=<"%UPDATE_DIR%\version.txt" 2>nul
    if defined UPDATE_VERSION (
        if not "!UPDATE_VERSION!"=="%APP_VERSION%" set "UPDATE_FOUND=1"
    ) else (
        set "UPDATE_FOUND=1"
    )
)

if "!UPDATE_FOUND!"=="1" (
    echo.
    echo  Update gefunden.
    if defined UPDATE_VERSION echo  Neue Version: !UPDATE_VERSION!
    call :INSTALL_UPDATES
    if errorlevel 1 (
        color 0C
        echo  [FEHLER] Update konnte nicht installiert werden.
        pause
        exit /b 1
    )
    set "RESTART_REQUIRED=1"
)

exit /b 0


:INSTALL_UPDATES
if not exist "%UPDATE_DIR%" exit /b 0

echo  Installiere Updates...
echo  Quelle: "%UPDATE_DIR%"

rem Robocopy kopiert den Update-Inhalt direkt in die Projektstruktur.
rem Rueckgabecode >= 8 bedeutet Fehler.
robocopy "%UPDATE_DIR%" "%ROOT_DIR%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if errorlevel 8 (
    echo  [FEHLER] Robocopy meldet einen Fehler beim Update.
    exit /b 1
)

rem Update-Quelle nach erfolgreicher Installation entfernen, damit es keinen Loop gibt.
rmdir /s /q "%UPDATE_DIR%" >nul 2>&1

echo  Update installiert.
exit /b 0


:INSTALL_DEPENDENCIES
echo.
echo  Pruefe Abhaengigkeiten...

rem Python suchen
set "PYTHON="
for %%C in (python python3 py) do (
    if not defined PYTHON (
        %%C --version >nul 2>&1 && set "PYTHON=%%C"
    )
)

if not defined PYTHON (
    color 0C
    echo  [FEHLER] Python nicht gefunden!
    echo  Bitte installieren: https://python.org/downloads
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%V in ('!PYTHON! --version 2^>^&1') do echo  Python: %%V

rem pip sicherstellen
echo  Pruefe pip...
!PYTHON! -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  Installiere pip...
    !PYTHON! -m ensurepip --upgrade >nul 2>&1
)

echo  Aktualisiere pip...
!PYTHON! -m pip install --upgrade pip >nul 2>&1

rem Python-Abhaengigkeiten installieren
if exist "!APP_DIR!\requirements.txt" (
    echo  Installiere Python-Abhaengigkeiten...
    !PYTHON! -m pip install -r "!APP_DIR!\requirements.txt"
) else (
    echo  Keine requirements.txt gefunden - uebersprungen
)

rem Node.js optional fuer Multiplayer
where node >nul 2>&1
if errorlevel 1 (
    echo  WARNUNG: Node.js nicht gefunden - Multiplayer nicht verfuegbar
) else (
    echo  Node.js gefunden
    if exist "!APP_DIR!\games\package.json" (
        echo  Installiere Node.js Abhaengigkeiten...
        pushd "!APP_DIR!\games"
        npm install
        popd
    )
)

echo  Abhaengigkeiten OK
echo.
exit /b 0


:INIT
if not exist "server.py" (
    color 0C
    echo  [FEHLER] server.py nicht gefunden in: !APP_DIR!
    pause & exit /b 1
)

goto START_SERVER


:START_SERVER
rem Pruefen ob Server bereits laeuft
set "_RUNNING=0"
if exist "server.pid" (
    for /f "usebackq delims=" %%A in ("server.pid") do set "SPID=%%A"
    if defined SPID (
        tasklist /FI "PID eq !SPID!" 2>nul | findstr /I "python" >nul 2>&1
        if not errorlevel 1 set "_RUNNING=1"
    )
)
if !_RUNNING!==1 (
    set "SV_PORT=8080"
    if exist "server.port" for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"
    echo  Server laeuft bereits auf Port !SV_PORT!
    goto READY
)

rem Alte Prozesse beenden
set "SV_PORT=8080"
if exist "server.port" for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"
if exist "server.pid" (
    for /f "usebackq delims=" %%A in ("server.pid") do set "SPID=%%A"
    if defined SPID taskkill /F /PID !SPID! >nul 2>&1
)
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do taskkill /F /PID %%P >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8765 "') do taskkill /F /PID %%P >nul 2>&1
wmic process where "commandline like '%%server.py%%'" delete >nul 2>&1

rem Port/PID-Dateien loeschen
del "server.pid"  >nul 2>&1
del "server.port" >nul 2>&1

rem Log rotieren
if exist "server.log" (
    move /Y "server.log" "server.log.bak" >nul 2>&1
)

echo  Starte MediaCenter Server...

rem HTTP-Server starten (ohne cmd /c, robust bei Klammern im Pfad)
start "" /B "!PYTHON!" "server.py" >> "server.log" 2>&1

rem Node.js Multiplayer-Server starten (falls verfuegbar)
netstat -ano 2>nul | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    where node >nul 2>&1
    if not errorlevel 1 (
        if exist "games\server.js" (
            pushd "games"
            start "" /B node "server.js" >> "server-ws.log" 2>&1
            popd
            echo  Multiplayer-Server ^(Node.js^) gestartet auf Port 8765
        )
    ) else (
        echo  WARNUNG: Node.js nicht gefunden - Multiplayer nicht verfuegbar
    )
) else (
    echo  Multiplayer-Server laeuft bereits auf Port 8765
)

rem Warten bis server.port geschrieben (max 18s)
set "SV_PORT=8080"
set /a _WP=0
:WAIT_PORT
if exist "server.port" goto PORT_READY
if !_WP! geq 18 goto WAIT_HTTP
timeout /t 1 /nobreak >nul
set /a _WP+=1
goto WAIT_PORT

:PORT_READY
for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"

rem Warten bis HTTP-Port offen (max 15s)
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
rem PID sichern
if not exist "server.pid" (
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do (
        echo %%P>"server.pid"
        goto :PID_DONE
    )
)
:PID_DONE

rem Browser oeffnen (PWA oder Standard)
call :OPEN_BROWSER http://localhost:!SV_PORT!

:READY
call :BANNER
set "SV_PORT=8080"
if exist "server.port" for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"

rem Mediathek zaehlen
set M_F=0 & set M_S=0 & set M_M=0 & set M_I=0
for /r "media\Movies" %%F in (*.mp4 *.mkv *.avi *.mov *.webm *.wmv *.m4v) do set /a M_F+=1
for /r "media\Series" %%F in (*.mp4 *.mkv *.avi *.mov *.webm *.wmv *.m4v) do set /a M_S+=1
for /r "media\Music"  %%F in (*.mp3 *.flac *.m4a *.aac *.ogg *.wav)       do set /a M_M+=1
for /r "media\Images" %%F in (*.jpg *.jpeg *.png *.gif *.webp *.bmp)       do set /a M_I+=1

rem Server-Status pruefen
netstat -ano 2>nul | findstr ":!SV_PORT! " >nul 2>&1
if errorlevel 1 (set "HST=INAKTIV") else (set "HST=AKTIV  ")
netstat -ano 2>nul | findstr ":8765 " >nul 2>&1
if errorlevel 1 (set "WST=INAKTIV") else (set "WST=AKTIV  ")

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
set "CMD="
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
if exist "server.pid" (
    for /f "usebackq delims=" %%A in ("server.pid") do set "SPID=%%A"
    if defined SPID taskkill /F /PID !SPID! >nul 2>&1
    del "server.pid" >nul 2>&1
)
wmic process where "commandline like '%%server.py%%'" delete >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8765 "') do taskkill /F /PID %%P >nul 2>&1
wmic process where "commandline like '%%games\\server.js%%'" delete >nul 2>&1
if exist "server.port" (
    for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":!SV_PORT! "') do taskkill /F /PID %%P >nul 2>&1
)
del "server.port" >nul 2>&1
color 0C
echo  +============================================================+
echo  ^|  MediaCenter gestoppt.   start = neu   x = beenden        ^|
echo  +============================================================+
color 0A
:STOP_LOOP
set "CMD="
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
set "SV_PORT=8080"
if exist "server.port" for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"
netstat -ano 2>nul | findstr ":!SV_PORT! " >nul 2>&1
if errorlevel 1 (set "HST=INAKTIV") else (set "HST=AKTIV  ")
netstat -ano 2>nul | findstr ":8765 " >nul 2>&1
if errorlevel 1 (set "WST=INAKTIV") else (set "WST=AKTIV  ")
echo  +============================================================+
echo  ^|  HTTP Port !SV_PORT! [!HST!]   WS Port 8765 [!WST!]           ^|
echo  +============================================================+
goto LOOP


:DO_LOG
echo  --- SERVER LOG (letzte 25 Zeilen) ---
if exist "server.log" (
    powershell -command "Get-Content 'server.log' -Tail 25" 2>nul || type "server.log"
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
echo  Pfad: %ROOT_DIR%
goto LOOP


:DO_BROWSER
set "SV_PORT=8080"
if exist "server.port" for /f "usebackq delims=" %%A in ("server.port") do set "SV_PORT=%%A"
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
set "_URL=%~1"

rem Edge App-Modus
set "_EDGE="
for %%P in ("%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
    if not defined _EDGE if exist %%P set "_EDGE=%%~P"
)
if defined _EDGE (
    start "" "!_EDGE!" --app="%_URL%" --start-maximized
    exit /b 0
)

rem Chrome App-Modus
set "_CHROME="
for %%P in ("%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe") do (
    if not defined _CHROME if exist %%P set "_CHROME=%%~P"
)
if defined _CHROME (
    start "" "!_CHROME!" --app="%_URL%" --start-maximized
    exit /b 0
)

rem Fallback Standard-Browser
start "" "%_URL%"
exit /b 0
