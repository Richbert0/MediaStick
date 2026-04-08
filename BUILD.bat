@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title MediaCenter Build

echo.
echo +================================================+
echo ^|   MediaCenter v2.1 - Desktop App Build        ^|
echo +================================================+
echo.

:: Ins Projektverzeichnis wechseln
cd /d "%~dp0"

:: Node.js pruefen
where node >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js nicht gefunden!
    echo Bitte installieren: https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%V in ('node --version') do echo Node.js: %%V

:: npm pruefen
where npm >nul 2>&1
if errorlevel 1 (
    echo FEHLER: npm nicht gefunden!
    pause & exit /b 1
)
for /f "tokens=*" %%V in ('npm --version') do echo npm:     %%V
echo.

:: Python pruefen (fuer dev)
set PYTHON=
for %%C in (python python3 py) do (
    if not defined PYTHON (
        %%C --version >nul 2>&1 && set PYTHON=%%C
    )
)
if defined PYTHON (
    for /f "tokens=*" %%V in ('!PYTHON! --version') do echo Python:  %%V
) else (
    echo WARNUNG: Python nicht gefunden - Desktop-Build waere nicht standalone
)
echo.

:: Projektstruktur pruefen
if not exist "%~dp0app\index.html" (
    echo FEHLER: app\index.html nicht gefunden!
    pause & exit /b 1
)
if not exist "%~dp0app\server.py" (
    echo FEHLER: app\server.py nicht gefunden!
    pause & exit /b 1
)

:: node_modules anlegen
if not exist "%~dp0node_modules" (
    echo Installiere Abhaengigkeiten...
    npm install
    if errorlevel 1 (
        echo FEHLER: npm install fehlgeschlagen!
        pause & exit /b 1
    )
) else (
    echo Abhaengigkeiten vorhanden - uebersprungen.
)
echo.

:: Multiplayer-Abhaengigkeiten fuer die Desktop-App sichern
if exist "%~dp0app\games\package.json" (
    if not exist "%~dp0app\games\node_modules" (
        echo Installiere Multiplayer-Abhaengigkeiten...
        npm install --prefix "%~dp0app\games"
        if errorlevel 1 (
            echo FEHLER: npm install fuer app\games fehlgeschlagen!
            pause & exit /b 1
        )
    ) else (
        echo Multiplayer-Abhaengigkeiten vorhanden - uebersprungen.
    )
    echo.
)

:: Alte dist loeschen
if exist "%~dp0dist" (
    echo Loesche altes dist/...
    rd /S /Q "%~dp0dist"
    timeout /t 1 /nobreak >nul
)

echo Die erzeugte Anwendung startet in einer eigenen MediaCenter-Desktop-UI.
echo Es wird kein externer Browser fuer die App verwendet.
echo.

:: Desktop-App starten oder bauen
echo +------------------------------------------------+
echo ^|  Was moechtest du tun?                        ^|
echo ^|  1 = Desktop-App testen                       ^|
echo ^|  2 = Portable Desktop-App bauen               ^|
echo ^|  3 = Installer bauen                          ^|
echo ^|  4 = Portable + Installer bauen               ^|
echo ^|  5 = Abbrechen                                ^|
echo +------------------------------------------------+
echo.
set /p CHOICE= Wahl (1-5): 

if "!CHOICE!"=="1" goto RUN_DEV
if "!CHOICE!"=="2" goto BUILD_PORT
if "!CHOICE!"=="3" goto BUILD_INST
if "!CHOICE!"=="4" goto BUILD_ALL
if "!CHOICE!"=="5" exit /b 0
echo Ungueltige Eingabe.
pause & exit /b 1

:RUN_DEV
echo.
echo Starte MediaCenter Desktop-App...
npm start
goto END

:BUILD_PORT
echo.
call :PREP_SERVER_EXE
if errorlevel 1 goto END_FAIL
echo Baue Portable EXE...
npx electron-builder --win portable --x64
goto CHECK_BUILD

:BUILD_INST
echo.
call :PREP_SERVER_EXE
if errorlevel 1 goto END_FAIL
echo Baue Installer...
npx electron-builder --win nsis --x64
goto CHECK_BUILD

:BUILD_ALL
echo.
call :PREP_SERVER_EXE
if errorlevel 1 goto END_FAIL
echo Baue Portable + Installer...
npx electron-builder --win portable nsis --x64
goto CHECK_BUILD

:PREP_SERVER_EXE
echo.
echo Bereite eingebetteten Python-Server vor...
if not defined PYTHON (
    echo FEHLER: Fuer Portable/Installer-Build wird Python 3.9+ benoetigt.
    exit /b 1
)

set "SERVER_EXE=%~dp0app\server_win.exe"
if not exist "%~dp0.build" md "%~dp0.build" >nul 2>&1

!PYTHON! -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo PyInstaller nicht gefunden - installiere...
    !PYTHON! -m pip install pyinstaller
    if errorlevel 1 (
        echo FEHLER: PyInstaller konnte nicht installiert werden.
        exit /b 1
    )
)

echo Erzeuge server_win.exe...
if exist "%SERVER_EXE%" del /q "%SERVER_EXE%" >nul 2>&1
!PYTHON! -m PyInstaller --noconfirm --clean --onefile --name server_win --distpath "%~dp0app" --workpath "%~dp0.build\pyi-work" --specpath "%~dp0.build\pyi-spec" "%~dp0app\server.py"
if errorlevel 1 (
    echo FEHLER: server_win.exe konnte nicht gebaut werden.
    exit /b 1
)
if not exist "%SERVER_EXE%" (
    echo FEHLER: server_win.exe fehlt nach dem Build.
    exit /b 1
)
echo server_win.exe bereit.
echo.
exit /b 0

:CHECK_BUILD
if errorlevel 1 (
    echo.
    echo FEHLER: Build fehlgeschlagen! Siehe Ausgabe oben.
    pause & exit /b 1
)
echo.
echo +================================================+
echo ^|  BUILD ERFOLGREICH!                           ^|
echo ^|  Ausgabe: dist\                               ^|
echo +================================================+
dir /B "%~dp0dist"
echo.

:END
pause
exit /b 0

:END_FAIL
echo.
echo Build abgebrochen.
pause
exit /b 1
