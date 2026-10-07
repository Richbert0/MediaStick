# Windows-Warnung „Der Computer wurde durch Windows geschützt“

## Warum erscheint die Meldung?

Microsoft Defender **SmartScreen** prüft jede `.exe`, die aus dem Internet heruntergeladen wurde.
Windows markiert solche Dateien beim Download („Mark of the Web“). Bei einer markierten Datei
ohne digitale Signatur und ohne bekannte „Reputation“ (also noch wenig heruntergeladen) blendet Windows diese Warnung ein.

Die Meldung heißt **nicht**, dass die Datei gefährlich ist. Windows kennt den Herausgeber nur noch nicht.

## Sofort-Lösungen für Nutzer (kostenlos)

| Weg | So geht's |
|---|---|
| **Einmal bestätigen** | *Weitere Informationen* → *Trotzdem ausführen*. Danach fragt Windows für diese Datei nicht mehr. |
| **Datei freigeben** | Rechtsklick auf die `.exe` → *Eigenschaften* → unten Haken bei **„Zulassen“** → *OK*. |
| **Vom USB-Stick starten** | Kopiert man die `.exe` auf einen Stick mit **exFAT/FAT32** (Standard bei USB-Sticks), geht die Download-Markierung verloren – dann erscheint keine Warnung. Genau so ist MediaCenter gedacht. |
| **PowerShell** | `Unblock-File .\MediaCenter-*-portable.exe` |

## Dauerhafte Lösung: Code-Signatur

Damit die Warnung für **alle** verschwindet, muss die `.exe` digital signiert sein. Die Build-Pipeline ist darauf vorbereitet. Es fehlt nur ein Zertifikat.

| Option | Kosten | Hinweise |
|---|---|---|
| **SignPath Foundation** | kostenlos | Für Open-Source-Projekte. Voraussetzung: öffentliches Repository **mit Open-Source-Lizenz** (z. B. MIT). Bewerbung unter signpath.org. |
| **Microsoft Trusted Signing** (Azure) | ca. 10 $/Monat | Günstigster kommerzieller Weg mit sehr guter SmartScreen-Akzeptanz. Für Privatpersonen nicht in allen Ländern verfügbar – Verfügbarkeit im Azure-Portal prüfen. |
| **OV-Code-Signing-Zertifikat** (z. B. Certum, Sectigo) | ca. 50–300 €/Jahr | Die Warnung verschwindet erst, wenn die signierte Datei genug Reputation gesammelt hat (einige hundert Downloads). Seit 2024 gilt das auch für teurere EV-Zertifikate. |

### Zertifikat (.pfx) in GitHub hinterlegen

1. Zertifikat als `.pfx`-Datei exportieren und in Base64 umwandeln:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("zertifikat.pfx")) | Set-Clipboard
   ```
2. Auf GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - `WIN_CSC_LINK` = der kopierte Base64-Text
   - `WIN_CSC_KEY_PASSWORD` = Passwort des Zertifikats
3. Fertig: Der nächste Build auf `main` signiert die `.exe` automatisch (electron-builder), und das Release enthält die signierte Datei.

> Hinweis: Neuere Zertifikate werden oft nur noch auf Hardware-Token bzw. in der Cloud ausgegeben (kein `.pfx`-Export).
> In dem Fall Microsoft Trusted Signing oder SignPath nutzen. Die Einbindung in den Workflow passe ich gern an.

## Und unter Linux (AppImage)?

Unter Linux gibt es **keine** vergleichbare Warnung. Nötig ist nur:

1. Datei ausführbar machen: Rechtsklick → *Eigenschaften* → *Als Programm ausführen erlauben*,
   oder `chmod +x MediaCenter-*.AppImage`.
2. Auf manchen Systemen (z. B. Ubuntu 22.04+) fehlt FUSE: `sudo apt install libfuse2`,
   oder ohne FUSE starten: `./MediaCenter-*.AppImage --appimage-extract-and-run`.
