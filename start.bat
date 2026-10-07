@echo off
chcp 65001 >nul
title MediaCenter Server
cd /d "%~dp0"
rem MediaCenter im Browser-/Server-Modus starten (ohne Desktop-Fenster).
rem Voraussetzung: Node.js 18+  ->  https://nodejs.org
rem Tipp: Die portable EXE kann dasselbe ohne Node:  MediaCenter.exe --server

where node >nul 2>&1
if errorlevel 1 (
  echo FEHLER: Node.js wurde nicht gefunden. Bitte Node.js 18+ installieren: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo Installiere Server-Abhaengigkeiten ...
  call npm install --omit=dev --no-audit --no-fund || (pause & exit /b 1)
)

node server\cli.js %*
pause
