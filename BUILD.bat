@echo off
chcp 65001 >nul
title MediaCenter Build
cd /d "%~dp0"
rem Baut die portable Windows-EXE (Ausgabe: dist\). Voraussetzung: Node.js 18+

where node >nul 2>&1
if errorlevel 1 (
  echo FEHLER: Node.js wurde nicht gefunden. Bitte Node.js 18+ installieren: https://nodejs.org
  pause
  exit /b 1
)

echo Installiere Abhaengigkeiten ...
call npm install --no-audit --no-fund || goto :fail

echo.
echo  1 = App testen (Entwicklungsmodus)
echo  2 = Portable EXE bauen
echo  3 = Abbrechen
set /p CHOICE= Auswahl (1-3): 
if "%CHOICE%"=="1" goto :run
if "%CHOICE%"=="2" goto :build
goto :end

:run
call npm start
goto :end

:build
call npm run build:win
if errorlevel 1 goto :fail
echo.
echo Fertig! Die portable EXE liegt in dist\
dir /b dist\*.exe
goto :end

:fail
echo.
echo Build fehlgeschlagen – siehe Ausgabe oben.
:end
pause
