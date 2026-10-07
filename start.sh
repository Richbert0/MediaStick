#!/usr/bin/env bash
# MediaCenter im Browser-/Server-Modus starten (ohne Desktop-Fenster).
# Voraussetzung: Node.js 18+  →  https://nodejs.org
# Tipp: Die portable App (.AppImage) kann dasselbe ohne Node: ./MediaCenter.AppImage --server
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "FEHLER: Node.js wurde nicht gefunden. Bitte Node.js 18+ installieren: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules/ws ] || [ ! -d node_modules/qrcode ]; then
  echo "Installiere Server-Abhängigkeiten …"
  npm install --omit=dev --no-audit --no-fund
fi

exec node server/cli.js "$@"
