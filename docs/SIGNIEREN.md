# Windows-Code-Signatur (kostenlos über die SignPath Foundation)

## Warum erscheint „Der Computer wurde durch Windows geschützt“?

Microsoft Defender **SmartScreen** prüft jede `.exe`, die aus dem Internet heruntergeladen wurde.
Ohne digitale Signatur kennt Windows den Herausgeber nicht und warnt. Die Datei ist deshalb nicht gefährlich.

Mit einer Signatur steht in der Meldung ein bekannter Herausgeber, und die Warnung verschwindet dauerhaft.
Für Open-Source-Projekte bietet die **[SignPath Foundation](https://signpath.org)** das **kostenlos** an.
MediaCenter ist dafür vorbereitet:

- Open-Source-Lizenz: [MIT](../LICENSE)
- keine proprietären Bestandteile: Abhängigkeiten MIT/ISC, Schriftarten SIL OFL
- vollautomatischer Build auf GitHub Actions direkt aus dem Quellcode
- Code-Signing-Richtlinie im [README](../README.md#-code-signatur)
- fertige Signier-Schritte im [Workflow](../.github/workflows/build.yml) und eine Artefakt-Konfiguration in [`.signpath/artifact-configuration.xml`](../.signpath/artifact-configuration.xml)

Solange SignPath nicht eingerichtet ist, baut der Workflow wie bisher unsigniert. Es geht nichts kaputt.

---

## Einrichtung (einmalig, ca. 15 Minuten + Wartezeit auf Freigabe)

### 1. Bei der SignPath Foundation bewerben
1. Auf **https://signpath.org** → *Apply* das Formular ausfüllen:
   - Projekt: **MediaCenter**, Repository: `https://github.com/Richbert0/MediaStick`
   - Lizenz: **MIT**
   - Download-Seite: `https://github.com/Richbert0/MediaStick/releases`
   - Build-System: **GitHub Actions**
2. Die Foundation prüft das Projekt und meldet sich per E-Mail. Danach gibt es einen Zugang zu **app.signpath.io** mit einem fertigen Projekt.

### 2. In SignPath (app.signpath.io) vorbereiten
1. **Projekt** öffnen, den *Slug* notieren (z. B. `MediaStick`).
2. **Trusted Build System:** *GitHub.com* mit dem Projekt verknüpfen. Dann wird nur signiert, was wirklich aus diesem Repository gebaut wurde.
3. **Artifact Configuration:** Inhalt von `.signpath/artifact-configuration.xml` einfügen und als Standard markieren.
4. **Signing Policy:** Slug notieren, meist `release-signing`.
5. **API-Token:** Unter *Users* einen CI-Benutzer (bzw. dein Konto) mit der Rolle *Submitter* anlegen und ein API-Token erzeugen.
6. Die **Organization ID** steht unter *Settings* bzw. in der URL.

### 3. In GitHub eintragen
Repository → **Settings → Secrets and variables → Actions**:

| Art | Name | Wert |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | das API-Token aus Schritt 2.5 |
| Variable | `SIGNPATH_ORGANIZATION_ID` | Organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | z. B. `MediaStick` (Standard, falls leer) |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | z. B. `release-signing` (Standard, falls leer) |
| Variable *(optional)* | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | nur nötig, wenn nicht die Standard-Konfiguration genutzt wird |

### 4. Signieren
- Bei jedem Push auf `main` (bzw. Tag `v*`) baut GitHub die EXE und schickt sie an SignPath.
- Bei der Release-Signatur muss ein **Approver** zustimmen: SignPath schickt eine E-Mail mit Link, ein Klick auf *Approve* genügt. Der Workflow wartet bis zu 2 Stunden darauf.
- Danach landet die **signierte EXE** automatisch im GitHub-Release. Der Workflow prüft die Signatur (`Get-AuthenticodeSignature`).

---

## Bis dahin: Warnung umgehen (für Nutzer)

| Weg | So geht's |
|---|---|
| Einmal bestätigen | *Weitere Informationen* → *Trotzdem ausführen* |
| Datei freigeben | Rechtsklick → *Eigenschaften* → Haken bei **„Zulassen“** |
| Vom USB-Stick starten | Auf exFAT/FAT32-Sticks geht die Download-Markierung verloren, dann erscheint keine Warnung |
| PowerShell | `Unblock-File .\MediaCenter-*-portable.exe` |

## Alternative: eigenes Zertifikat

Wer ein eigenes Code-Signing-Zertifikat als `.pfx` besitzt, kann es stattdessen nutzen. Dafür in GitHub die Secrets
`WIN_CSC_LINK` (Base64 der `.pfx`) und `WIN_CSC_KEY_PASSWORD` anlegen. electron-builder signiert dann direkt beim Build.

## Und unter Linux (AppImage)?

Linux kennt keine solche Warnung. Nötig ist nur:

1. Ausführbar machen: Rechtsklick → *Eigenschaften* → *Als Programm ausführen erlauben*, oder `chmod +x MediaCenter-*.AppImage`.
2. **libfuse2** installieren, falls das AppImage nicht startet (u. a. Ubuntu 22.04 und neuer, Linux Mint 21+, Debian 12):
   `sudo apt install libfuse2` (Ubuntu 24.04: `sudo apt install libfuse2t64`).
   Ohne Installation geht es auch: `./MediaCenter-*.AppImage --appimage-extract-and-run`.
