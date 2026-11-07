# Jungle Leopard LCD für SignalRGB

SignalRGB-Plugin, das das **960 × 480 Pixel große Pumpen-Display** der Jungle-Leopard-AIO-Kühler
(TZMRIT PF360 / ProFlow 360, USB-ID `33C3:7788`) zu einem **nativen SignalRGB-LCD-Gerät** macht.

Das Plugin bringt **keine eigene Designbibliothek** mit. Es meldet das Display über die offizielle
SignalRGB-LCD-Schnittstelle (`@SignalRGB/lcd`, `DeviceType "lcd"`) an. Dadurch stehen dieselben
LCD-Faces zur Auswahl, die SignalRGB auch für NZXT-, Corsair- oder Lian-Li-LCDs anbietet,
inklusive eigener Faces aus `Dokumente\WhirlwindFX\LCDFaces`. SignalRGB rendert das gewählte Face,
das Plugin bereitet die Bilder auf und bringt sie zum Display.

> **Status:** Implementiert und umfangreich gegen simulierte Hardware getestet, inklusive eines echten
> Ende-zu-Ende-Tests über UDP, die Bridge und eine serielle Schnittstelle (siehe [Tests](#entwicklung--tests)).
> Am echten Kühler bestätigt: Erkennung in SignalRGB, Face-Auswahl und USB-Diagnose. Die Bildübertragung über
> die Bridge steht dort noch aus.

## So funktioniert es

```
SignalRGB-Library ──► gewähltes LCD-Face (HTML) ──► SignalRGB rendert im 960×480-Viewport
                                                              │  LCD.getFrame()
                                                              ▼
                              Plugin: Format prüfen ─► (bei Bedarf) drehen / zentrieren / neu kodieren
                                                              │  UDP an 127.0.0.1
                                                              ▼
                              Jungle Leopard LCD Bridge (kleines Hilfsprogramm, Symbol im Infobereich)
                                                              │  COM-Port (wie die Hersteller-App)
                                                              ▼
                                    Jungle-Leopard-Display (960×480, Baseline-JPEG 4:2:0, ≤ 80 KB)
```

* **Face-Auswahl, Face-Einstellungen, Sensoren, „Now Playing“, Drehung und das Speichern der Auswahl**
  übernimmt SignalRGB selbst. Die Auswahl bleibt deshalb auch nach einem Neustart erhalten.
* Passt das von SignalRGB gelieferte Bild schon zum Display (960×480, Baseline-JPEG, 4:2:0, ≤ 80 KB),
  wird es **unverändert** weitergereicht. Ansonsten wandelt das Plugin es automatisch um.
* Kann etwas nicht angezeigt werden, erscheint auf dem Display **und** in SignalRGB eine verständliche
  Meldung statt eines schwarzen Bildschirms (siehe [Meldungen](#meldungen-auf-dem-display)).

**Warum eine Bridge?** Das Display ist ein USB-Seriell-Gerät; seine Datenkanäle liegen auf USB-Interface 1.
SignalRGB öffnet bei Raw-USB-Geräten aber nur Interface 0 und bietet Plugins keine Möglichkeit, ein anderes
Interface zu wählen oder einen COM-Port zu öffnen (am echten Gerät nachgewiesen, siehe
[docs/signalrgb-lcd-integration.md](docs/signalrgb-lcd-integration.md)). Plugins dürfen aber UDP senden. Deshalb
schickt das Plugin den fertigen Datenstrom an die Bridge auf demselben PC, und die schreibt ihn auf den COM-Port
des Displays. Kann SignalRGB das Display direkt beschreiben, nutzt das Plugin automatisch den direkten Weg.

## Voraussetzungen

* Windows 10/11 mit einer aktuellen SignalRGB-Version mit LCD-Face-Unterstützung
* Jungle-Leopard-Kühler mit dem 960×480-Display. Im Geräte-Manager steht es unter *Anschlüsse (COM & LPT)*
  als „Serielles USB-Gerät (COMx)“ mit der Hardware-ID `VID_33C3&PID_7788`.
* Der **normale Windows-Treiber** des Displays (kein Zadig/WinUSB nötig)

## Installation

Drei Schritte: Plugin in SignalRGB holen, Bridge installieren, Face auswählen.

### 1. Plugin in SignalRGB holen

**Variante A – als Add-on direkt von GitHub (empfohlen, aktualisiert sich selbst):**

Windows-Taste + R drücken, diese Zeile einfügen und Enter:

```
signalrgb://addon/install?url=https://github.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-
```

SignalRGB öffnet sich und fragt, ob das Add-on installiert werden soll → bestätigen und, falls gefragt,
SignalRGB neu starten. Alternativ in SignalRGB unter **Settings → Plugins → Add Plugin Repository** dieselbe
GitHub-Adresse (ohne `signalrgb://…`) eintragen. SignalRGB lädt das Repository beim Start selbst herunter.

**Variante B – von Hand:** Die Datei [`Jungle_Leopard_LCD.js`](Jungle_Leopard_LCD.js) herunterladen und nach

```
%USERPROFILE%\Documents\WhirlwindFX\Plugins\
```

kopieren (Ordner ggf. anlegen; mit OneDrive heißt der Pfad oft `%USERPROFILE%\OneDrive\Dokumente\WhirlwindFX\Plugins\`).

Nur eine der beiden Varianten verwenden, sonst ist das Plugin doppelt vorhanden.

### 2. Bridge installieren (einmalig, ohne Admin-Rechte)

1. Die Hersteller-App beenden und aus dem Autostart nehmen. Den COM-Port kann immer nur ein Programm benutzen.
2. **Windows-Taste + X** → **Terminal** (oder „Windows PowerShell“) öffnen.
3. Diese Zeile einfügen und Enter drücken:

   ```powershell
   irm https://raw.githubusercontent.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-/HEAD/bridge/install.ps1 | iex
   ```

Das Skript ([`bridge/install.ps1`](bridge/install.ps1)) kopiert die Bridge nach
`%LOCALAPPDATA%\JungleLeopardBridge`, legt eine Verknüpfung in den Autostart und startet sie. Unten rechts im
Infobereich erscheint ein Symbol; beim Drüberfahren steht dort z. B. „verbunden mit COM5“. Rechtsklick auf das
Symbol → *Log anzeigen* bzw. *Beenden*. Die Bridge besteht aus [`bridge/JungleLeopardBridge.ps1`](bridge/JungleLeopardBridge.ps1)
und [`bridge/JungleLeopardBridge.cs`](bridge/JungleLeopardBridge.cs) (wird beim Start von Windows PowerShell kompiliert).

Wer kein Skript aus dem Internet ausführen möchte: Repository als ZIP herunterladen, entpacken und
`powershell -ExecutionPolicy Bypass -File bridge\install.ps1` ausführen.

Findet die Bridge den Port nicht automatisch, eine Datei `port.txt` mit z. B. `COM5` nach
`%LOCALAPPDATA%\JungleLeopardBridge` legen und die Bridge neu starten.

> **Zadig/WinUSB schon benutzt?** Dann zuerst rückgängig machen, sonst gibt es keinen COM-Port:
> Geräte-Manager → *USB-Geräte* → das Display (z. B. „MONITOR“) → Rechtsklick → **Gerät deinstallieren** →
> Haken bei **„Treiber für dieses Gerät entfernen“** → *Deinstallieren* → *Aktion* → **Nach geänderter Hardware
> suchen**. Danach steht es wieder als „Serielles USB-Gerät (COMx)“ unter *Anschlüsse (COM & LPT)*.

### 3. SignalRGB neu starten und Face auswählen

SignalRGB über das Symbol im Infobereich beenden (Rechtsklick → **Quit**) und neu starten. Das Display erscheint
als **„Jungle Leopard LCD“**. Dort wie bei jedem anderen LCD-Gerät ein LCD-Face aus der SignalRGB-Library
auswählen und anpassen. Die Auswahl speichert SignalRGB selbst.

**Woran man sieht, dass die Verbindung steht:** Ist noch kein Face gewählt, zeigt das Display nach etwa
1,5 Sekunden „Kein LCD-Face aktiv“. Diese Meldung kommt bereits vom Plugin, der Weg bis zum Display funktioniert also.

## Einstellungen

In SignalRGB unter den Geräteeinstellungen von „Jungle Leopard LCD“:

| Einstellung | Wirkung |
|---|---|
| **Face Layout** | *Full Panel (960x480)*: Das Face wird direkt im 960×480-Format gerendert, responsive Faces nutzen die ganze Breite. *Original Square (480x480)*: Das Face wird exakt wie auf einem quadratischen 480×480-LCD gerendert und mittig platziert. Das ist originalgetreu für Faces, die nur für runde oder quadratische Displays gestaltet sind. |
| **Screen Orientation** | Montage des magnetischen Displays: *Landscape*, *Landscape (Upside Down)*, *Portrait (Rotated Right/Left)*. Hochkant wird das Face in 480×960 gerendert und für das Panel gedreht. Die Option wählen, bei der das Face aufrecht steht. Für 180° kann alternativ die Face-Drehung von SignalRGB genutzt werden. |
| **Side Fill Color** | Farbe der freien Fläche, z. B. links/rechts beim quadratischen Layout. |
| **LCD Backlight** | Hintergrundbeleuchtung 0–100 %. |
| **Max Frame Rate** | Obergrenze der Bilder pro Sekunde (5–30). Niedriger = weniger CPU- und USB-Last. |
| **Re-encode Quality** | JPEG-Qualität, falls ein Bild umgewandelt werden muss. Wird automatisch gesenkt, wenn ein Bild sonst das 80-KB-Limit des Displays überschreiten würde, und danach wieder angehoben. |
| **Message Language** | Sprache der Meldungen auf dem Display und in SignalRGB (Deutsch/English). |
| **On Shutdown** | Beim Beenden von SignalRGB bzw. im Standby: Display an die eigene Firmware zurückgeben oder Hintergrundbeleuchtung ausschalten. |
| **Startup Diagnostics** | Zeigt nach dem Start eine SignalRGB-Benachrichtigung „Jungle Leopard LCD - Diagnose“ mit dem USB-Befund (Endpunkte, Ergebnis der Übertragung, Antwort des Displays). Kann ausgeschaltet werden, sobald alles läuft. |

## Meldungen auf dem Display

Statt einer leeren Anzeige zeigt das Display in diesen Fällen eine Erklärung, zusätzlich erscheint eine
SignalRGB-Benachrichtigung:

| Code | Bedeutung | Abhilfe |
|---|---|---|
| `NO_FACE` | SignalRGB liefert kein Bild (kein Face gewählt oder Face lädt nicht) | In SignalRGB ein LCD-Face auswählen |
| `FACE_INCOMPATIBLE` | Das Face liefert ein Format, das sich nicht umwandeln lässt; der Grund steht in der Meldung | Anderes Face wählen oder SignalRGB aktualisieren |
| `RAW_UNAVAILABLE` | Drehung bzw. quadratisches Layout brauchen Rohbilder, die diese SignalRGB-Version nicht liefert | *Full Panel* + *Landscape* wählen oder die Face-Drehung von SignalRGB nutzen |
| `FRAME_TOO_LARGE` | Selbst bei niedrigster Qualität über 80 KB pro Bild | Ruhigeres Face oder quadratisches Layout wählen |
| `RENDER_ERROR` | Unerwarteter Fehler beim Aufbereiten | Wird automatisch erneut versucht; Details im SignalRGB-Gerätelog |

Nur als SignalRGB-Benachrichtigung (das Display kann sie in diesen Fällen nicht zeigen):

* **Bridge nicht erreichbar**: Das Plugin schickt die Bilder an die Bridge, sie antwortet aber nicht. Bridge
  installieren (Schritt 2) bzw. über die Autostart-Verknüpfung starten.
* **Display-COM-Port nicht gefunden**: Die Bridge läuft, aber das Display hat keinen COM-Port. Meist ist noch der
  WinUSB-Treiber aus Zadig aktiv (siehe Hinweis in Schritt 2).
* **Bridge meldet einen Fehler**: Die Bridge kann den COM-Port nicht öffnen oder beschreiben, meist weil die
  Hersteller-App ihn noch belegt.
* **Display antwortet nicht** (nur bei direktem USB): SignalRGB erkennt das Gerät, das Display antwortet aber nicht.
* **Verbindung zum Display unterbrochen**: Weder der direkte USB-Weg noch die Bridge funktionieren; der Grund steht
  in der Meldung. Das Plugin versucht es automatisch erneut.
* **Nicht unterstütztes Display**: Hinter `33C3:7788`, einer generischen Demo-ID, steckt ein Display mit anderer
  Auflösung. Das Plugin sendet dann bewusst keine Bilder.

## Fehlersuche

**SignalRGB zeigt „Jungle Leopard LCD“, das Display aber weiter seine eigene Animation:** Läuft die Bridge?
Das Symbol im Infobereich zeigt beim Drüberfahren ihren Zustand. Fehlt es, die Bridge über die Autostart-Verknüpfung
starten oder neu installieren (Schritt 2). Zum Testen geht auch
`powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\JungleLeopardBridge\JungleLeopardBridge.ps1" -Console`:
Dann zeigt ein Fenster den Status direkt an. Das Bridge-Log liegt unter
`%LOCALAPPDATA%\JungleLeopardBridge\bridge.log`.

**In Zadig versehentlich den Treiber eines anderen Geräts ersetzt (z. B. Tastatur):** Geräte-Manager öffnen
(Windows-Taste + X → *Geräte-Manager*) → *USB-Geräte* aufklappen. Bei jedem Eintrag Rechtsklick →
*Eigenschaften* → Reiter *Treiber*: Steht als Treiberanbieter **libwdi**, hat Zadig ihn installiert. Ist es nicht
das Display, Rechtsklick → **Gerät deinstallieren** → Haken bei **„Treiber für dieses Gerät entfernen“** →
*Deinstallieren*. Danach das Gerät aus- und wieder einstecken oder den PC neu starten; Windows installiert
wieder den normalen Treiber.

**Diagnose:** Die Benachrichtigung **„Jungle Leopard LCD - Diagnose“** zeigt, welche USB-Endpunkte das Gerät meldet
(`USB: …`), was ein direkter USB-Versuch ergab (`Write: …`, `Probe: …`), welcher Weg benutzt wird
(`Transport: bulk` oder `bridge`) und was die Bridge meldet (`Bridge: …`). Mit diesem Text lässt sich der Fehler
eingrenzen.

**Log:** Das Plugin schreibt alle Meldungen mit dem Präfix `[JL-LCD]` in die Gerätekonsole von SignalRGB und in
SignalRGBs Logdatei (laut Community-Angaben unter `%LOCALAPPDATA%\WhirlwindFX\SignalRgb\Logs\`). Beim Start steht
dort, was die USB-Aufrufe zurückgeben, z. B. `First bulk write returned: …` und `Panel check: …`. Diese Zeilen
helfen bei der Fehlersuche.

## Rückgängig machen

1. Add-on in SignalRGB unter **Settings → Plugins** entfernen bzw. bei Variante B die Plugin-Datei aus
   `Documents\WhirlwindFX\Plugins` löschen.
2. Bridge entfernen: `powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\JungleLeopardBridge\uninstall.ps1"`
   (beendet sie und entfernt Autostart-Eintrag und Ordner).
3. Nur falls Zadig benutzt wurde: Geräte-Manager → *Ansicht* → *Ausgeblendete Geräte anzeigen* → unter
   „USB-Geräte“ das Display (`33C3:7788`) → **Gerät deinstallieren** und **„Treiber für dieses Gerät entfernen“**
   anhaken → neu starten oder USB neu verbinden. Danach ist der COM-Port zurück.

## Bekannte Einschränkungen

* **Bildübertragung am echten Gerät noch nicht bestätigt.** Protokoll, Bildformat und Timing stammen aus den unten
  genannten Reverse-Engineering-Projekten (Firmware 3.1). Das getestete Gerät meldet Revision 2.00; ob es dasselbe
  Protokoll spricht, zeigt erst der Test mit der Bridge.
* Die Bridge ist nötig, weil SignalRGB Plugins weder COM-Ports noch die Wahl des USB-Interfaces erlaubt.
  Hersteller-App und Bridge können den COM-Port nicht gleichzeitig nutzen; die Bridge gibt ihn 5 Sekunden nach dem
  letzten Bild von SignalRGB wieder frei.
* Viele offizielle Faces sind für runde 480×480-Displays entworfen. Responsive Faces füllen 960×480 automatisch,
  für andere ist *Original Square* die originalgetreue Darstellung.
* Die Displayhardware nimmt höchstens ca. 30 Bilder/s und 80 KB pro Bild an.

## Entwicklung & Tests

```bash
npm test                                   # Node ≥ 20.6, keine Abhängigkeiten
python3 tests/crosscheck/pillow_crosscheck.py   # optional, braucht Pillow
```

* `tests/plugin.test.mjs`: kompletter Lebenszyklus (Initialize/Render/Shutdown) gegen einen simulierten
  SignalRGB-Host und eine **simulierte Panel-Firmware**. Diese parst jeden gesendeten USB-Byte-Strom, prüft alle
  Prüfsummen und dass jedes Bild ein 960×480-Baseline-JPEG mit 4:2:0 und ≤ 80 KB ist.
* `tests/bridge.test.mjs`: Bridge-Modus wie auf der getesteten Hardware (`bulk_transfer` liefert `array(-1)`):
  UDP-Datagramme werden unabhängig wieder zusammengesetzt und von der simulierten Firmware geprüft; dazu
  Status-Meldungen der Bridge.
* `tests/bridge.e2e.test.mjs`: **Ende-zu-Ende** – Plugin → echtes UDP → die echte Bridge (`bridge/JungleLeopardBridge.cs`,
  mit Mono kompiliert) → virtuelle serielle Schnittstelle (socat) → simulierte Firmware. Läuft automatisch, wenn
  `mcs`, `mono` und `socat` installiert sind, sonst wird er übersprungen. Die Bridge wird dabei als C# 5 kompiliert,
  so wie Windows PowerShell 5.1 sie übersetzt.
* `tests/crosscheck/`: dekodiert die tatsächlich gesendeten Bilder für alle Layouts und Ausrichtungen mit
  Pillow/libjpeg und prüft Lage und Farbe von Orientierungsmarken.
* Die Regeln des offiziellen SignalRGB-Plugin-Validators sind in den Tests nachgebildet. Der Code hält die
  ESLint-Regeln des offiziellen [signal-plugins](https://gitlab.com/signalrgb/signal-plugins)-Repos ein.

## Credits

* USB-Protokoll des Displays: Reverse Engineering von
  [senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD](https://github.com/senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD)
  und [yughias/JL-LCD-AIO](https://github.com/yughias/JL-LCD-AIO). Es wurde kein Code übernommen.
* SignalRGB-Plugin-API: offizielles Repository [signalrgb/signal-plugins](https://gitlab.com/signalrgb/signal-plugins).
* JPEG-Quantisierungs- und Huffman-Tabellen: Standardtabellen aus ITU-T T.81, Anhang K.
* Bitmap-Schrift und Gerätebild: eigens für dieses Projekt erstellt.
