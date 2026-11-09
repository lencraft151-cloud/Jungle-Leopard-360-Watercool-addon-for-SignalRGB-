# Jungle Leopard LCD für SignalRGB

SignalRGB-Plugin, das das **960 × 480 Pixel große Pumpen-Display** der Jungle-Leopard-AIO-Kühler
(TZMRIT PF360 / ProFlow 360, USB-ID `33C3:7788`) zu einem **nativen SignalRGB-LCD-Gerät** macht.

Das Plugin bringt **keine eigene Designbibliothek** mit. Es meldet das Display über die offizielle
SignalRGB-LCD-Schnittstelle (`@SignalRGB/lcd`, `DeviceType "lcd"`) an. Dadurch stehen dieselben
LCD-Faces zur Auswahl, die SignalRGB auch für NZXT-, Corsair- oder Lian-Li-LCDs anbietet,
inklusive eigener Faces aus `Dokumente\WhirlwindFX\LCDFaces`. SignalRGB rendert das gewählte Face,
das Plugin bereitet die Bilder auf und bringt sie zum Display.

> **Status (2.0.0):** Das Display ist ein COM-Port-Gerät. Das Plugin spricht es jetzt über SignalRGBs
> **offizielles Serial-Modul** an (`@SignalRGB/serial`), genau wie SignalRGBs eigene Plugins für das Turzx-LCD
> und das HYTE CNVS. Es braucht **keinen Zusatztreiber und kein Hilfsprogramm** mehr. Umfangreich gegen
> simulierte Hardware getestet (siehe [Tests](#entwicklung--tests)). Am echten Kühler bestätigt: Erkennung in
> SignalRGB und Face-Auswahl. Die Bildübertragung über den Serial-Weg steht dort noch aus.

## So funktioniert es

```
SignalRGB-Library ──► gewähltes LCD-Face (HTML) ──► SignalRGB rendert im 960×480-Viewport
                                                              │  LCD.getFrame()
                                                              ▼
                              Plugin: Format prüfen ─► (bei Bedarf) drehen / zentrieren / neu kodieren
                                                              │  @SignalRGB/serial (COM-Port des Displays)
                                                              ▼
                                    Jungle-Leopard-Display (960×480, Baseline-JPEG 4:2:0, ≤ 80 KB)
```

* **Face-Auswahl, Face-Einstellungen, Sensoren, „Now Playing“, Drehung und das Speichern der Auswahl**
  übernimmt SignalRGB selbst. Die Auswahl bleibt deshalb auch nach einem Neustart erhalten.
* Passt das von SignalRGB gelieferte Bild schon zum Display (960×480, Baseline-JPEG, 4:2:0, ≤ 80 KB),
  wird es **unverändert** weitergereicht. Ansonsten wandelt das Plugin es automatisch um.
* **Display an/aus** direkt in SignalRGB: Schalter *Display On* in den Geräteeinstellungen.
* Kann etwas nicht angezeigt werden, erscheint auf dem Display **und** in SignalRGB eine verständliche
  Meldung statt eines schwarzen Bildschirms (siehe [Meldungen](#meldungen-auf-dem-display)).

## Voraussetzungen

* Windows 10/11 mit einer **aktuellen SignalRGB-Version** (2.5 oder neuer: dort gibt es das Serial-Modul für
  Plugins). Ältere Versionen laden das Plugin nicht → SignalRGB aktualisieren.
* Jungle-Leopard-Kühler mit dem 960×480-Display. Im Geräte-Manager steht es unter *Anschlüsse (COM & LPT)*
  als „Serielles USB-Gerät (COMx)“ mit der Hardware-ID `VID_33C3&PID_7788`.
* Der **normale Windows-Treiber** des Displays. **Kein** Zadig/WinUSB.

## Installation

### 0. Aufräumen, falls du ältere Versionen ausprobiert hast

* **Zadig/WinUSB benutzt?** Rückgängig machen, sonst gibt es keinen COM-Port:
  Geräte-Manager (Windows-Taste + X → *Geräte-Manager*) → *USB-Geräte* → das Display (z. B. „MONITOR“) →
  Rechtsklick → **Gerät deinstallieren** → Haken bei **„Treiber für dieses Gerät entfernen“** → *Deinstallieren*
  → oben *Aktion* → **Nach geänderter Hardware suchen**. Danach steht es wieder als „Serielles USB-Gerät (COMx)“
  unter *Anschlüsse (COM & LPT)*. Falls nicht: PC neu starten.
* **„Jungle Leopard LCD Bridge“ installiert** (Version 1.1.0)? Wird nicht mehr gebraucht. Entfernen mit
  Windows-Taste + X → *Terminal*, dann:

  ```powershell
  irm https://raw.githubusercontent.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-/HEAD/bridge/uninstall.ps1 | iex
  ```

### 1. Hersteller-App beenden

Den COM-Port kann immer nur ein Programm benutzen. Die Hersteller-App des Displays ganz beenden (auch das Symbol
unten rechts im Infobereich) und aus dem Autostart nehmen (Task-Manager → *Autostart*).

### 2. Plugin in SignalRGB holen

**Variante A – als Add-on direkt von GitHub (empfohlen, aktualisiert sich selbst):**

Windows-Taste + R drücken, diese Zeile einfügen und Enter:

```
signalrgb://addon/install?url=https://github.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-
```

SignalRGB öffnet sich und fragt, ob das Add-on installiert werden soll → bestätigen. Alternativ in SignalRGB unter
**Settings → Plugins → Add Plugin Repository** dieselbe GitHub-Adresse (ohne `signalrgb://…`) eintragen.

**Variante B – von Hand:** Die Datei [`Jungle_Leopard_LCD.js`](Jungle_Leopard_LCD.js) herunterladen und nach

```
%USERPROFILE%\Documents\WhirlwindFX\Plugins\
```

kopieren (Ordner ggf. anlegen; mit OneDrive heißt der Pfad oft `%USERPROFILE%\OneDrive\Dokumente\WhirlwindFX\Plugins\`).

Nur eine der beiden Varianten verwenden, sonst ist das Plugin doppelt vorhanden.

### 3. SignalRGB neu starten und Face auswählen

SignalRGB über das Symbol im Infobereich beenden (Rechtsklick → **Quit**) und neu starten. Das Display erscheint
als **„Jungle Leopard LCD“**. Dort wie bei jedem anderen LCD-Gerät ein LCD-Face aus der SignalRGB-Library
auswählen und anpassen. Die Auswahl speichert SignalRGB selbst.

**Woran man sieht, dass die Verbindung steht:** Die Animation des Herstellers (Kugeln) verschwindet. Ist noch
kein Face gewählt, zeigt das Display nach etwa 1,5 Sekunden „Kein LCD-Face aktiv“. Diese Meldung kommt bereits
vom Plugin, der Weg bis zum Display funktioniert also.

## RGB-Beleuchtung der Wasserkühlung (Pumpe und Lüfter)

Das Display und die RGB-Beleuchtung sind beim Jungle Leopard **zwei getrennte Systeme**:

* Das **Display** hängt am internen USB-Anschluss. Nur darum kümmert sich dieses Plugin. Das Display-Protokoll
  hat keinen einzigen Befehl für LEDs (vollständige Befehlsliste der Hersteller-App, siehe
  [docs/signalrgb-lcd-integration.md](docs/signalrgb-lcd-integration.md)).
* Die **Beleuchtung** von Pumpe und Lüftern ist normales **5V-ARGB mit 3-Pin-Stecker** („5V 3PIN ARGB“). Dieser
  Stecker führt nur ein Datensignal **zu** den LEDs, nichts zurück. Deshalb kann **kein Programm** die
  Beleuchtung „erkennen“, auch SignalRGB, iCUE oder die Mainboard-Software nicht. Das gilt für alle ARGB-Kühler.

Steuern lässt sie sich trotzdem: über einen ARGB-Anschluss, den SignalRGB ansteuern kann.

1. **PC ausschalten und Netzstecker ziehen.**
2. Den ARGB-Stecker der Wasserkühlung (3 Kabel, eine Buchse ist zugestopft) auf einen **5V-ARGB-Anschluss des
   Mainboards** stecken. Er heißt je nach Hersteller z. B. `JRAINBOW`/`JARGB_V2` (MSI), `ADD_GEN2`
   (ASUS), `D_LED` (Gigabyte) oder `ADDR_LED` (ASRock) und hat **3 Pins** mit einer Lücke. Das
   Mainboard-Handbuch zeigt, wo er sitzt.
   **Nicht** auf einen 4-poligen 12V-RGB-Anschluss stecken (z. B. `JRGB`, `RGB_HEADER`, `LED_C`): Das zerstört
   die LEDs.
3. Haben Pumpe und Lüfter **zwei getrennte ARGB-Stecker**, am besten jeden auf einen eigenen ARGB-Anschluss
   stecken. Mit einem Y-Verteiler zeigen beide dasselbe Muster.
4. In SignalRGB unter **Geräte** das **Mainboard** öffnen. Dort gibt es pro ARGB-Anschluss einen Kanal. Beim
   Kanal der Wasserkühlung **Komponente hinzufügen** wählen. Gibt es den Kühler nicht in der Liste, eine
   **LED-Leiste mit passender LED-Anzahl** anlegen. Danach lassen sich Pumpe und Lüfter im Layout frei
   anordnen und wie jedes andere Gerät steuern.

Erscheint das Mainboard in SignalRGB nicht oder ohne ARGB-Kanäle, unterstützt SignalRGB dessen ARGB-Anschlüsse
nicht. Dann braucht es einen USB-ARGB-Controller, den SignalRGB unterstützt. Das Gehäuse-Hub mit Fernbedienung
bzw. Taste kann SignalRGB in der Regel nicht ansteuern, weil es keine USB-Verbindung hat.

## Einstellungen

In SignalRGB unter den Geräteeinstellungen von „Jungle Leopard LCD“:

| Einstellung | Wirkung |
|---|---|
| **Display On** | Display ein- oder ausschalten. Aus = Hintergrundbeleuchtung 0 und schwarzes Bild, solange SignalRGB läuft. Die Animation des Herstellers kommt dabei nicht zurück. |
| **Face Layout** | *Full Panel (960x480)*: Das Face wird direkt im 960×480-Format gerendert, responsive Faces nutzen die ganze Breite. *Original Square (480x480)*: Das Face wird exakt wie auf einem quadratischen 480×480-LCD gerendert und mittig platziert. Das ist originalgetreu für Faces, die nur für runde oder quadratische Displays gestaltet sind. |
| **Screen Orientation** | Montage des magnetischen Displays: *Landscape*, *Landscape (Upside Down)*, *Portrait (Rotated Right/Left)*. Hochkant wird das Face in 480×960 gerendert und für das Panel gedreht. Die Option wählen, bei der das Face aufrecht steht. Für 180° kann alternativ die Face-Drehung von SignalRGB genutzt werden. |
| **Side Fill Color** | Farbe der freien Fläche, z. B. links/rechts beim quadratischen Layout. |
| **LCD Backlight** | Hintergrundbeleuchtung 0–100 %. |
| **Max Frame Rate** | Obergrenze der Bilder pro Sekunde (5–30). Niedriger = weniger CPU- und USB-Last. |
| **Re-encode Quality** | JPEG-Qualität, falls ein Bild umgewandelt werden muss. Wird automatisch gesenkt, wenn ein Bild sonst das 80-KB-Limit des Displays überschreiten würde, und danach wieder angehoben. |
| **Message Language** | Sprache der Meldungen auf dem Display und in SignalRGB (Deutsch/English). |
| **On Shutdown** | Beim Beenden von SignalRGB: Display an die eigene Firmware zurückgeben (*Release to Panel*) oder Hintergrundbeleuchtung ausschalten (*Backlight Off*). Im Standby wird die Beleuchtung immer ausgeschaltet. |
| **Startup Diagnostics** | Zeigt nach dem Start eine SignalRGB-Benachrichtigung „Jungle Leopard LCD - Diagnose“ mit dem Verbindungsbefund (COM-Port, Ergebnis des ersten Schreibens, Antwort des Displays). Kann ausgeschaltet werden, sobald alles läuft. |

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

* **COM-Port des Displays belegt**: Ein anderes Programm hält den Port, meist die Hersteller-App (auch im
  Infobereich) oder die alte Bridge. Beenden bzw. entfernen (siehe [Schritt 0](#0-aufräumen-falls-du-ältere-versionen-ausprobiert-hast)).
  Das Plugin versucht es alle zwei Sekunden erneut und verbindet sich dann von selbst.
* **Verbindung zum Display unterbrochen**: Schreiben auf den COM-Port ist fehlgeschlagen (z. B. Display
  abgesteckt). Das Plugin verbindet sich automatisch neu.
* **SignalRGB-Update nötig**: Diese SignalRGB-Version gibt Plugins keinen Zugriff auf COM-Ports.
* **Nicht unterstütztes Display**: Hinter `33C3:7788`, einer generischen Demo-ID, steckt ein Display mit anderer
  Auflösung. Das Plugin sendet dann bewusst keine Bilder.

## Fehlersuche

**„Jungle Leopard LCD“ taucht in SignalRGB gar nicht auf:** Im Geräte-Manager prüfen, ob unter
*Anschlüsse (COM & LPT)* ein „Serielles USB-Gerät (COMx)“ mit `VID_33C3&PID_7788` steht (Rechtsklick →
*Eigenschaften* → *Details* → *Hardware-IDs*). Steht das Display stattdessen unter *USB-Geräte*, ist noch der
Zadig-Treiber aktiv (siehe [Schritt 0](#0-aufräumen-falls-du-ältere-versionen-ausprobiert-hast)). Außerdem
SignalRGB aktualisieren.

**SignalRGB zeigt das Gerät, das Display aber weiter seine eigene Animation:** Die Benachrichtigungen von
SignalRGB ansehen (Glocke oben rechts). „COM-Port des Displays belegt“ heißt: Hersteller-App oder alte Bridge
läuft noch.

**Diagnose:** Die Benachrichtigung **„Jungle Leopard LCD - Diagnose“** zeigt in einer Zeile:
`Serial:` (hat SignalRGB das Serial-Modul), `Port:` (welchen COM-Port SignalRGB dem Gerät zugeordnet hat),
`Connect:` (ob er sich öffnen ließ), `Write:` (was das erste Schreiben zurückgab) und `Reply:` (ob und was das
Display geantwortet hat). Mit diesem Text lässt sich der Fehler eingrenzen.

**Log:** Das Plugin schreibt alle Meldungen mit dem Präfix `[JL-LCD]` in die Gerätekonsole von SignalRGB und in
SignalRGBs Logdatei (laut Community-Angaben unter `%LOCALAPPDATA%\WhirlwindFX\SignalRgb\Logs\`).

**In Zadig versehentlich den Treiber eines anderen Geräts ersetzt (z. B. Tastatur):** Geräte-Manager öffnen
(Windows-Taste + X → *Geräte-Manager*) → *USB-Geräte* aufklappen. Bei jedem Eintrag Rechtsklick →
*Eigenschaften* → Reiter *Treiber*: Steht als Treiberanbieter **libwdi**, hat Zadig ihn installiert. Ist es nicht
das Display, Rechtsklick → **Gerät deinstallieren** → Haken bei **„Treiber für dieses Gerät entfernen“** →
*Deinstallieren*. Danach das Gerät aus- und wieder einstecken oder den PC neu starten; Windows installiert
wieder den normalen Treiber.

## Rückgängig machen

Add-on in SignalRGB unter **Settings → Plugins** entfernen bzw. bei Variante B die Plugin-Datei aus
`Documents\WhirlwindFX\Plugins` löschen. Beim Beenden gibt das Plugin den COM-Port frei, danach kann die
Hersteller-App das Display wieder übernehmen.

## Bekannte Einschränkungen

* **Bildübertragung am echten Gerät noch nicht bestätigt.** Protokoll, Bildformat und Timing stammen aus den unten
  genannten Reverse-Engineering-Projekten (Firmware 3.1, gleiche USB-ID `33C3:7788`).
* Hersteller-App und SignalRGB können den COM-Port nicht gleichzeitig nutzen.
* Viele offizielle Faces sind für runde 480×480-Displays entworfen. Responsive Faces füllen 960×480 automatisch,
  für andere ist *Original Square* die originalgetreue Darstellung.
* Die Displayhardware nimmt höchstens ca. 30 Bilder/s und 80 KB pro Bild an.

## Entwicklung & Tests

```bash
npm test                                   # Node ≥ 20.6, keine Abhängigkeiten
python3 tests/crosscheck/pillow_crosscheck.py   # optional, braucht Pillow
```

* `tests/plugin.test.mjs`: kompletter Lebenszyklus (Initialize/Render/Shutdown) gegen einen simulierten
  SignalRGB-Host mit nachgebildetem `@SignalRGB/serial`-Modul und eine **simulierte Panel-Firmware**. Diese parst
  jeden gesendeten Byte-Strom, prüft alle Prüfsummen und dass jedes Bild ein 960×480-Baseline-JPEG mit 4:2:0 und
  ≤ 80 KB ist. Dazu: belegter Port, abgestecktes Display, Teil-Schreibvorgänge, fehlendes Serial-Modul,
  Display an/aus.
* `tests/crosscheck/`: dekodiert die tatsächlich gesendeten Bilder für alle Layouts und Ausrichtungen mit
  Pillow/libjpeg und prüft Lage und Farbe von Orientierungsmarken.
* Die Regeln des offiziellen SignalRGB-Plugin-Validators sind in den Tests nachgebildet. Der Code hält die
  ESLint-Regeln des offiziellen [signal-plugins](https://gitlab.com/signalrgb/signal-plugins)-Repos ein.

## Credits

* USB-Protokoll des Displays: Reverse Engineering von
  [senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD](https://github.com/senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD)
  und [yughias/JL-LCD-AIO](https://github.com/yughias/JL-LCD-AIO). Es wurde kein Code übernommen.
* SignalRGB-Plugin-API: offizielles Repository [signalrgb/signal-plugins](https://gitlab.com/signalrgb/signal-plugins),
  insbesondere das Serial-Modul (`@SignalRGB/Serial`) und die Plugins `Plugins/Turzx/Turzx_LCD_Controller.js` und
  `Plugins/Hyte/CNVS.js` im Branch `beta`.
* JPEG-Quantisierungs- und Huffman-Tabellen: Standardtabellen aus ITU-T T.81, Anhang K.
* Bitmap-Schrift und Gerätebild: eigens für dieses Projekt erstellt.
