## 🎬 MediaCenter – portable Ausgabe

**Herunterladen, auf den USB-Stick legen, starten.** Keine Installation, kein Python, kein Node.js, kein Internet nötig.

| System | Datei |
|---|---|
| 🪟 Windows 10/11 (64 Bit) | `MediaCenter-*-portable.exe` – Doppelklick |
| 🐧 Linux (x64) | `MediaCenter-*-x86_64.AppImage` – `chmod +x` und starten |
| 🍓 Raspberry Pi 4/5 (64-Bit-OS) & ARM64 | `MediaCenter-*-arm64.AppImage` – `chmod +x` und starten |

Beim ersten Start entsteht neben der Datei der Ordner **`MediaCenter-Daten`**. Dort liegen Medien, Einstellungen, Spielstände und Bestenlisten.

> [!IMPORTANT]
> **Linux: AppImage startet nicht?** Aktuelle Distributionen (Ubuntu 22.04+, Linux Mint 21+, Debian 12) brauchen einmalig **libfuse2**:
> `sudo apt install libfuse2` (Ubuntu 24.04 und neuer: `sudo apt install libfuse2t64`).
> Ohne Installation: `./MediaCenter-*.AppImage --appimage-extract-and-run`

### Neu in 3.5.1
- **Raspberry Pi:** Neues portables AppImage für Raspberry Pi 4/5 und andere ARM64-Geräte (`MediaCenter-*-arm64.AppImage`). Es wird nativ auf ARM gebaut und getestet. Anleitung inkl. Autostart und Server-Betrieb steht in der README.

### Neu in 3.5.0
- **Filme im Streaming-Stil:** Titelbild, „Weiterschauen“, „Neu hinzugefügt“, eigene Kategorien als Reihen und „Alle Filme“ mit Sortierung. Die Kachelgröße ist einstellbar (S–XL).
- **Eigene Film-Kategorien:** Anlegen, umbenennen, sortieren und löschen unter ⚙️ Einstellungen. Zugewiesen werden sie auf der Filme-Seite.
- **Bearbeitungsmodus:** Vorschaubild ändern, Kategorien zuweisen und in den Papierkorb verschieben geht erst nach Klick auf das ⚙️-Zahnrad oben rechts. So landet nichts versehentlich im Papierkorb.
- **Neues App-Logo** als Programm-Icon und in der Oberfläche. In der App folgt es der Designfarbe.
- **Eine Kopfzeile statt zwei:** Logo, Bereich, Adresse mit Port, Lautstärke, Neu laden, Vollbild, Kiosk und die Fensterknöpfe in einer Zeile.
- **Designfarbe:** Die Schrift ist jetzt passend zur Palette getönt. Bei „Eigene Farbe“ ist auch die Zweitfarbe wählbar.
- **Musik am Handy:** Neue Playlists lassen sich auch im Hochformat anlegen (Chip „＋ Neue Playlist“).
- **Chat:** Lässt sich in der Desktop-App nicht mehr unter die Titelleiste schieben und bleibt so immer greifbar.

### Neu in 3.4.0
- **Designfarbe wählbar:** Unter ⚙️ Einstellungen gibt es 9 abgestimmte Paletten oder eine eigene Farbe. Die Farbe gilt sofort für alle Bereiche, die Spiele und alle verbundenen Geräte.
- **Vollbild & Kiosk überarbeitet:** Vollbild schaltet die ganze App bildschirmfüllend, ohne die Seite neu zu laden. Kiosk zeigt nur den Inhalt, die Leisten erscheinen am Bildschirmrand bzw. über „⋯“. Beide Modi bleiben beim Seitenwechsel und beim „Neu laden“ erhalten. Esc schließt zuerst offene Fenster und beendet erst danach den Modus. Video-Vollbild und Spiele beenden den Kiosk-Modus nicht mehr.
- **Chat:** Das Fenster lässt sich frei verschieben (Maus & Touch) und am PC in der Größe ändern, Position und Größe werden gespeichert. Die Bildschirmtastatur springt nicht mehr ungefragt auf, am Handy öffnet sich die Handy-Tastatur erst beim Antippen des Eingabefelds.
- Musiksymbole in Designfarbe, README neu strukturiert.

### Neu in 3.3.0
- **Videoplayer neu:** echtes Vollbild über den ganzen Bildschirm, Steuerleiste verschwindet bei Inaktivität und erscheint bei Mausbewegung/Tippen wieder. Nach dem Filmende bzw. Schließen ist die Oberfläche sofort wieder bedienbar.
- **Vorschaubilder:** beliebige Stelle im Video auswählen (Regler, ±1 s/±10 s, Zufall) oder eigenes Bild – keine schwarzen Bilder mehr; fehlende Vorschaubilder werden automatisch erzeugt.
- **Serien im Streaming-Stil:** Titelbild, „Weiterschauen“, Fortschritt pro Folge, automatische nächste Folge und Abfrage „Mit Staffel X weiterschauen?“ am Staffelende. Erkennung von `S1F1`, `S01F01`, `S1E1`, `S01E01`.
- **QR-Code führt zum richtigen PC:** bevorzugt die echte Netzwerkkarte (statt Hyper-V/VirtualBox/VPN), Adresse bei mehreren Netzwerken umschaltbar.
- **Smartphone:** Musik-Steuerung unten (Visualizer → Tasten → Infos), Spielhalle scrollt zuverlässig, LAN-Anmeldung und alle Spiele im Vollflächen-Modus spielbar.

### Neu in 3.2.1
- **Open Source (MIT-Lizenz)** und Vorbereitung der kostenlosen Windows-Code-Signatur über die SignPath Foundation.
- Hinweise zu **libfuse2** für Linux in README und Release-Text.

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

**Hinweis Windows:** Erscheint „Der Computer wurde durch Windows geschützt“, einmalig auf *Weitere Informationen → Trotzdem ausführen* klicken. Vom USB-Stick (exFAT/FAT32) gestartet erscheint die Meldung nicht. Signierte Versionen werden über die kostenlose Code-Signatur der SignPath Foundation bereitgestellt, sobald diese freigeschaltet ist (`docs/SIGNIEREN.md`).

Kostenlose Code-Signatur bereitgestellt von SignPath.io, Zertifikat von der SignPath Foundation.
