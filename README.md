# Jungle Leopard LCD für SignalRGB

SignalRGB-Plugin, das das **960 × 480 Pixel große Pumpen-Display** der Jungle-Leopard-AIO-Kühler
(TZMRIT PF360 / ProFlow 360, USB-ID `33C3:7788`) zu einem **nativen SignalRGB-LCD-Gerät** macht.

Das Plugin bringt **keine eigene Designbibliothek** mit. Es meldet das Display über die offizielle
SignalRGB-LCD-Schnittstelle (`@SignalRGB/lcd`, `DeviceType "lcd"`) an. Dadurch stehen dieselben
LCD-Faces zur Auswahl, die SignalRGB auch für NZXT-, Corsair- oder Lian-Li-LCDs anbietet,
inklusive eigener Faces aus `Dokumente\WhirlwindFX\LCDFaces`. SignalRGB rendert das gewählte Face,
das Plugin überträgt die Bilder per USB auf das Display.

> **Status:** Implementiert und umfangreich gegen simulierte Hardware getestet (siehe [Tests](#entwicklung--tests)).
> Ein Test am echten Kühler steht noch aus. Rückmeldungen bitte als Issue.

## So funktioniert es

```
SignalRGB-Library ──► gewähltes LCD-Face (HTML) ──► SignalRGB rendert im 960×480-Viewport
                                                              │  LCD.getFrame()
                                                              ▼
                              Plugin: Format prüfen ─► (bei Bedarf) drehen / zentrieren / neu kodieren
                                                              │  USB-Bulk-Transfer
                                                              ▼
                                    Jungle-Leopard-Display (960×480, Baseline-JPEG 4:2:0, ≤ 80 KB)
```

* **Face-Auswahl, Face-Einstellungen, Sensoren, „Now Playing“, Drehung und das Speichern der Auswahl**
  übernimmt SignalRGB selbst. Die Auswahl bleibt deshalb auch nach einem Neustart erhalten.
* Passt das von SignalRGB gelieferte Bild schon zum Display (960×480, Baseline-JPEG, 4:2:0, ≤ 80 KB),
  wird es **unverändert** weitergereicht. Ansonsten wandelt das Plugin es automatisch um.
* Kann etwas nicht angezeigt werden, erscheint auf dem Display **und** in SignalRGB eine verständliche
  Meldung statt eines schwarzen Bildschirms (siehe [Meldungen](#meldungen-auf-dem-display)).

Details zur Untersuchung (wie SignalRGB LCD-Faces lädt und rendert, welche Schnittstellen es gibt) stehen in
[docs/signalrgb-lcd-integration.md](docs/signalrgb-lcd-integration.md).

## Voraussetzungen

* Windows 10/11 mit einer aktuellen SignalRGB-Version mit LCD-Face-Unterstützung
* Jungle-Leopard-Kühler mit dem 960×480-Display (meldet sich als „CherryUSB CDC DEMO“, `VID_33C3&PID_7788`)
* Einmalig: WinUSB-Treiber für das Display (Schritt 2)

## Installation

Drei Schritte: Plugin in SignalRGB holen, einmal den USB-Treiber umstellen, Face auswählen.

### 1. Plugin in SignalRGB holen

**Variante A – als Add-on direkt von GitHub (empfohlen, aktualisiert sich selbst):**

SignalRGB schließen ist nicht nötig. Windows-Taste + R drücken, diese Zeile einfügen und Enter:

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

### 2. WinUSB-Treiber einrichten (einmalig)

Ab Werk meldet sich das Display als **virtueller COM-Port** (USB-CDC). SignalRGB-Plugins können aber
keine COM-Ports öffnen, nur HID-, SMBus- und Raw-USB-Geräte (libusb). Damit SignalRGB das Display direkt
ansprechen kann, braucht es den Windows-eigenen **WinUSB**-Treiber:

1. Hersteller-App beenden und aus dem Autostart nehmen, ebenso andere Display-Tools
   (z. B. JungleLeopardDisplayManager, lcd_aio).
2. [Zadig](https://zadig.akeo.ie/) herunterladen und starten (keine Installation nötig, Admin-Abfrage bestätigen).
3. Menü *Options* → **List All Devices** anhaken.
4. In der Auswahlliste das Gerät wählen, bei dem rechts als USB-ID **`33C3 7788`** steht
   (Name meist „CherryUSB CDC DEMO“ oder „USB Serial Device“). Steht hinter dem Namen „(Interface 0)“, diesen
   Eintrag nehmen. Gibt es zusätzlich „(Interface 1)“, Schritt 5 danach auch dafür ausführen.
5. Rechts neben dem grünen Pfeil **WinUSB** auswählen → **Replace Driver** → warten, bis Zadig „successfully“ meldet.
6. SignalRGB beenden (Rechtsklick aufs Tray-Symbol → Quit) und neu starten.

> **Wichtig:** Danach gibt es keinen COM-Port mehr. Die Hersteller-App und COM-Port-Tools funktionieren erst
> wieder, wenn der Treiber zurückgesetzt wird (siehe [Rückgängig machen](#rückgängig-machen)).

### 3. LCD-Face auswählen

In SignalRGB erscheint das Display als **„Jungle Leopard LCD“**. Dort wie bei jedem anderen LCD-Gerät ein
LCD-Face aus der SignalRGB-Library auswählen und anpassen. Die Auswahl speichert SignalRGB selbst.

**Woran man sieht, dass die Verbindung steht:** Ist noch kein Face gewählt, zeigt das Display nach etwa
1,5 Sekunden „Kein LCD-Face aktiv“. Diese Meldung kommt bereits vom Plugin, die USB-Verbindung funktioniert also.

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

* **Display antwortet nicht**: SignalRGB erkennt das Gerät, das Display antwortet aber nicht. Meist fehlt der
  WinUSB-Treiber (Schritt 2) oder die Hersteller-App belegt das Display.
* **Verbindung zum Display unterbrochen**: USB-Übertragung fehlgeschlagen; das Plugin verbindet sich automatisch neu.
* **Nicht unterstütztes Display**: Hinter `33C3:7788`, einer generischen Demo-ID, steckt ein Display mit anderer
  Auflösung. Das Plugin sendet dann bewusst keine Bilder.

## Fehlersuche

**SignalRGB zeigt „Jungle Leopard LCD“ an, das Display bleibt aber leer:** SignalRGB erkennt das Gerät schon
ohne WinUSB-Treiber, weil es nur die USB-ID sieht. Senden kann es erst mit dem Treiber, also Schritt 2
ausführen und SignalRGB über das Tray-Symbol beenden und neu starten.

**Log:** Das Plugin schreibt alle Meldungen mit dem Präfix `[JL-LCD]` in die Gerätekonsole von SignalRGB und in
SignalRGBs Logdatei (laut Community-Angaben unter `%LOCALAPPDATA%\WhirlwindFX\SignalRgb\Logs\`). Beim Start steht
dort, was die USB-Aufrufe zurückgeben, z. B. `First bulk write returned: …` und `Panel check: …`. Diese Zeilen
helfen bei der Fehlersuche.

## Rückgängig machen

1. Add-on in SignalRGB unter **Settings → Plugins** entfernen bzw. bei Variante B die Plugin-Datei aus
   `Documents\WhirlwindFX\Plugins` löschen.
2. Geräte-Manager → *Ansicht* → *Ausgeblendete Geräte anzeigen* → unter „USB-Geräte“ das Display
   (`33C3:7788`) → **Gerät deinstallieren** und **„Treiber für dieses Gerät entfernen“** anhaken.
3. Neu starten oder USB neu verbinden. Windows bindet wieder den Standard-Treiber, der COM-Port ist zurück.

## Bekannte Einschränkungen

* **Noch nicht am echten Gerät getestet.** Protokoll, Bildformat und Timing stammen aus den unten genannten
  Reverse-Engineering-Projekten. Die USB-Endpunkte entsprechen dem CherryUSB-CDC-Template (Interface 1,
  Bulk-OUT `0x02`, Bulk-IN `0x81`). Das gesamte Plugin wurde gegen einen Simulator dieses Protokolls getestet.
* Der WinUSB-Schritt ist nötig, weil SignalRGB-Plugins keine serielle Schnittstelle haben. Hersteller-App und
  SignalRGB können das Display nicht gleichzeitig nutzen.
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
