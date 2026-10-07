## 🎬 MediaCenter – portable Ausgabe

**Herunterladen, auf den USB-Stick legen, starten.** Keine Installation, kein Python, kein Node.js, kein Internet nötig.

| System | Datei |
|---|---|
| 🪟 Windows 10/11 (64 Bit) | `MediaCenter-*-portable.exe` – Doppelklick |
| 🐧 Linux (x64) | `MediaCenter-*-x86_64.AppImage` – `chmod +x` und starten |

Beim ersten Start entsteht neben der Datei der Ordner **`MediaCenter-Daten`** – dort liegen Medien, Einstellungen, Spielstände und Bestenlisten.

### Neu in 3.2.0
- **Musik-Visualizer:** Spektrum-Balken oder Wellenform über dem Player, Kreis-Spektrum rund um die Platte im Vinyl-Vollbild (Umschalten mit 〰).
- **Musik läuft weiter:** Beim Wechsel zwischen allen Bereichen (auch zur Startseite) spielt die Musik weiter und pausiert nur, wenn ein Film oder eine Serie startet.
- **Eigene Medienordner:** Unter ⚙️ Einstellungen beliebig viele Ordner hinzufügen. Inhalte werden automatisch in Filme, Serien, Musik und Fotos einsortiert.
- **Aufgeräumte Startseite** mit Einstellungen im Menü.
- Vorbereitung für signierte Windows-Builds (siehe `docs/SIGNIEREN.md`).

### Seit 3.1.0
- **Komplett eigenständig:** Der frühere Python-Server wurde durch einen eingebauten Node.js-Server ersetzt (HTTP, Video-Streaming, Uploads, WebSocket – alles auf einem Port).
- **Wirklich portabel:** Alle Daten inklusive Browser-Speicher liegen neben der App statt im Benutzerprofil.
- **Neue Spielhalle:** 11 Spiele, jedes allein *und* zu zweit spielbar – gegen die KI, an einem Gerät oder im LAN.
- **LAN-Lobby:** Anmelden → Raum mit 4-stelligem Code → Mitspieler einladen → gemeinsam starten. Quiz, Kopfrechnen und Tipp-Rennen mit bis zu 8 Spielern.
- **Neue Spiele & Modi:** Vier gewinnt, Tetris-Duell mit Müllreihen, Snake gegen KI, Memory-KI mit Gedächtnis, Buzzer-Duelle, Tipp-Rennen u. v. m.
- **Gemeinsame Bestenlisten** für alle Geräte im Netz.
- **Server-Modus ohne Fenster:** `MediaCenter --server` (läuft unter Linux auch ohne grafische Oberfläche).
- Viele Fehlerkorrekturen: Papierkorb im Upload-Bereich, Serienzählung, Aktualisieren der Mediathek, Windows-Icon, Offline-Schriftarten und QR-Codes.

**Hinweis Windows:** Bei „Der Computer wurde durch Windows geschützt“ einmalig auf *Weitere Informationen → Trotzdem ausführen* klicken. Vom USB-Stick (exFAT/FAT32) gestartet erscheint die Meldung nicht. Hintergrund und dauerhafte Lösung: `docs/SIGNIEREN.md`.
