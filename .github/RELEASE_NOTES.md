## 🎬 MediaCenter – portable Ausgabe

**Herunterladen, auf den USB-Stick legen, starten.** Keine Installation, kein Python, kein Node.js, kein Internet nötig.

| System | Datei |
|---|---|
| 🪟 Windows 10/11 (64 Bit) | `MediaCenter-*-portable.exe` – Doppelklick |
| 🐧 Linux (x64) | `MediaCenter-*-x86_64.AppImage` – `chmod +x` und starten |

Beim ersten Start entsteht neben der Datei der Ordner **`MediaCenter-Daten`** – dort liegen Medien, Einstellungen, Spielstände und Bestenlisten.

### Neu in dieser Version
- **Komplett eigenständig:** Der frühere Python-Server wurde durch einen eingebauten Node.js-Server ersetzt (HTTP, Video-Streaming, Uploads, WebSocket – alles auf einem Port).
- **Wirklich portabel:** Alle Daten inklusive Browser-Speicher liegen neben der App statt im Benutzerprofil.
- **Neue Spielhalle:** 11 Spiele, jedes allein *und* zu zweit spielbar – gegen die KI, an einem Gerät oder im LAN.
- **LAN-Lobby:** Anmelden → Raum mit 4-stelligem Code → Mitspieler einladen → gemeinsam starten. Quiz, Kopfrechnen und Tipp-Rennen mit bis zu 8 Spielern.
- **Neue Spiele & Modi:** Vier gewinnt, Tetris-Duell mit Müllreihen, Snake gegen KI, Memory-KI mit Gedächtnis, Buzzer-Duelle, Tipp-Rennen u. v. m.
- **Gemeinsame Bestenlisten** für alle Geräte im Netz.
- **Server-Modus ohne Fenster:** `MediaCenter --server` (läuft unter Linux auch ohne grafische Oberfläche).
- Viele Fehlerkorrekturen: Papierkorb im Upload-Bereich, Serienzählung, Aktualisieren der Mediathek, Windows-Icon, Offline-Schriftarten und QR-Codes.

**Hinweis Windows:** Bei „Windows hat den PC geschützt“ auf *Weitere Informationen → Trotzdem ausführen* klicken (die Datei ist nicht kostenpflichtig signiert).
