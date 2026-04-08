# MediaCenter v2.0 – Portable Edition

Lokales MediaCenter für Filme, Serien, Musik, Fotos und Spiele.
Läuft als Electron-App, im Browser oder direkt über start.bat.

---

## Schnellstart

### Windows (Browser-Modus)
```
start.bat
```

### Windows (Electron-App)
```
BUILD.bat → Option 1 (Testen)
```

### Linux / Mac
```bash
chmod +x start.sh && ./start.sh
```

---

## Verzeichnisstruktur

```
MediaStick-v2/
├── app/                    ← Alle App-Dateien
│   ├── server.py           ← HTTP-Server (Python 3.9+)
│   ├── index.html          ← Hauptseite
│   ├── FILME.html          ← Filmseite mit Player
│   ├── SERIEN.html         ← Serien mit Staffeln/Episoden
│   ├── MUSIK.html          ← Audio-Player mit Playlists
│   ├── FOTOS.html          ← Fotogalerie mit Lightbox
│   ├── SPIELE.html         ← Spielhalle
│   ├── upload.html         ← Upload + Papierkorb
│   ├── css/main.css        ← Shared Styles
│   ├── js/app.js           ← Shared Utilities
│   ├── components/chat.js  ← LAN-Chat Widget
│   ├── media/              ← Medien-Dateien
│   │   ├── Movies/
│   │   ├── Series/         ← z.B. Series/Breaking Bad/S01/S01E01.mp4
│   │   ├── Music/
│   │   ├── Images/
│   │   └── Trash/
│   ├── games/
│   │   ├── server.js       ← WebSocket-Multiplayer (Node.js)
│   │   ├── lobby.html      ← Spieler-Lobby
│   │   ├── solo/           ← Snake, Tetris, Memory, Pong, 2048, Breakout
│   │   └── multi/          ← Quiz, TicTacToe
│   └── api/                ← JSON-Metadaten
├── electron-main.js        ← Electron Haupt-Prozess
├── preload.js              ← Electron Context Bridge
├── package.json            ← Electron-Builder Config
├── BUILD.bat               ← Build-Skript (Windows)
├── start.bat               ← Start ohne Electron (Windows)
└── start.sh                ← Start ohne Electron (Linux/Mac)
```

---

## Electron Build (Windows)

### Voraussetzungen
- Node.js 18+ (https://nodejs.org)
- Python 3.9+ (https://python.org)

### Build ausführen
```
BUILD.bat
```
Wähle:
- **Option 1**: Testen (startet direkt)
- **Option 2**: Portable .exe (keine Installation nötig)
- **Option 3**: Installer (.exe mit Setup)

### Ausgabe
```
dist/
├── MediaCenter Setup 2.0.0.exe   ← Installer
└── MediaCenter 2.0.0.exe         ← Portable (kein Setup)
```

---

## Medien hochladen

### Via Browser
1. MediaCenter öffnen
2. Upload-Seite → Dateien ziehen oder klicken

### Automatische Erkennung
| Dateiname | Wird erkannt als |
|---|---|
| `Breaking.Bad.S01E02.mkv` | Serie: Breaking Bad, S01E02 |
| `Inception.mp4` | Film |
| `Artist - Song.mp3` | Musik |
| `Foto.jpg` | Foto |

---

## LAN-Chat & Multiplayer

- **LAN-Chat**: Automatisch über WebSocket Port 8765
- **Multiplayer-Quiz**: Bis 8 Spieler gleichzeitig
- **TicTacToe LAN**: 2 Spieler über Raum-ID
- Alle Geräte im selben WLAN können mitspielen

---

## API-Übersicht

| Endpoint | Methode | Beschreibung |
|---|---|---|
| `/api/library` | GET | Alle Medien |
| `/api/media?file=...` | GET | Streaming (Range-Support) |
| `/api/upload` | POST | Datei hochladen |
| `/api/thumbnail` | GET/POST | Thumbnails |
| `/api/trash` | GET/POST | Papierkorb |
| `/api/qrcode-url` | GET | Server-URL als QR |
| `/api/music_meta` | GET/POST | Musik-Metadaten |
| `/api/image-meta` | GET/POST | Foto-Metadaten |

---

## Systemanforderungen

| | Minimum |
|---|---|
| Python | 3.9+ |
| Node.js | 18+ (nur für Multiplayer + Electron-Build) |
| Browser | Chrome 90+, Edge 90+, Firefox 88+ |
| OS | Windows 10+, Linux, macOS 11+ |
