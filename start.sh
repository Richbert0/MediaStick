#!/bin/bash
# MediaCenter v2.0 – Linux/Mac Start-Skript
set -e
DIR="$(cd "$(dirname "$0")/app" && pwd)"
cd "$DIR"

echo ""
echo "============================================================"
echo "   MediaCenter v2.0 – Portable Edition"
echo "============================================================"

# Python finden
PYTHON=""
for cmd in python3 python python3.11 python3.10 python3.9; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON="$cmd"
        echo "   Python:  $($cmd --version 2>&1)"
        break
    fi
done
if [ -z "$PYTHON" ]; then
    echo "   FEHLER: Python 3.9+ nicht gefunden!"
    echo "   Ubuntu/Debian: sudo apt install python3"
    echo "   Mac: brew install python3"
    exit 1
fi

# Alte Prozesse beenden
if [ -f server.pid ]; then
    OLD_PID=$(cat server.pid 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "   Beende alten Server (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f server.pid
fi
rm -f server.port

# Server starten
echo "   Starte HTTP-Server..."
nohup "$PYTHON" server.py >> server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > server.pid
echo "   Server PID: $SERVER_PID"

# Node.js Multiplayer
if command -v node &>/dev/null && [ -f "games/server.js" ]; then
    if ! lsof -i:8765 &>/dev/null 2>&1; then
        echo "   Starte Multiplayer-Server (Node.js, Port 8765)..."
        cd games
        nohup node server.js >> server-ws.log 2>&1 &
        cd "$DIR"
    else
        echo "   Multiplayer-Server laeuft bereits"
    fi
else
    echo "   WARNUNG: Node.js nicht gefunden – Multiplayer nicht verfuegbar"
fi

# Warten bis Port offen
echo -n "   Warte auf Server"
PORT=8080
for i in $(seq 1 20); do
    if [ -f server.port ]; then
        PORT=$(cat server.port)
        break
    fi
    sleep 0.5
    echo -n "."
done
echo ""

# Browser öffnen
URL="http://localhost:$PORT/"
echo "   URL: $URL"
if command -v xdg-open &>/dev/null; then
    xdg-open "$URL" &>/dev/null &
elif command -v open &>/dev/null; then
    open "$URL"
fi

echo ""
echo "============================================================"
echo "   Server laeuft. STRG+C zum Beenden."
echo "============================================================"
echo ""

# Auf Beenden warten
cleanup() {
    echo ""
    echo "   Beende Server..."
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f server.pid server.port
    echo "   Fertig."
    exit 0
}
trap cleanup SIGINT SIGTERM

wait "$SERVER_PID"
