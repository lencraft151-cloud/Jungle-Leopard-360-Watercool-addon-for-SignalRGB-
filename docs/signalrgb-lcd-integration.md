# SignalRGB-LCD-Integration: Untersuchung und Umsetzung

Dieses Dokument hält fest, wie SignalRGB LCD-Faces lädt und rendert, ob diese Infrastruktur für
Drittanbieter-LCDs zugänglich ist, und wie das Plugin darauf aufbaut.

Stand der Untersuchung: November 2026. Grundlage sind der Development-Branch des offiziellen Repos
`signalrgb/signal-plugins` (Stand 2025-09) und die öffentlichen SignalRGB-Changelogs.

## 1. Wie SignalRGB LCD-Faces lädt und rendert

**LCD-Faces sind HTML-Seiten**, vergleichbar mit SignalRGB-Lightscripts:

* Einstellungen deklariert ein Face über `<meta property="…" label="…" type="…" default="…">`, z. B. `boolean`,
  `number`, `color`, `combobox`, `textfield` und `sensor`. SignalRGB baut daraus die Bedienelemente in der
  Oberfläche.
* Live-Daten kommen über die Engine-API des Faces, z. B. `engine.getSensorValue("CPU Load")`. Seit 2.5.66 gibt es
  zusätzlich `engine.audio` für audio-reaktive Faces.
* Das Layout ist typischerweise responsiv (`width: 100vw; height: 100vh`, Flexbox). Ein Face passt sich also dem
  Viewport an, den SignalRGB ihm gibt.
* Quellen: die SignalRGB-Library in der App sowie eigene Faces im Benutzerordner
  `%USERPROFILE%\Documents\WhirlwindFX\LCDFaces`.

**Rendering-Pfad** (laut offizieller Plugin-API `types/lcd.d.ts`):

```ts
LCD.initialize({ width: number, height: number, circular?: boolean }): void
LCD.getFrame({ format: "JPEG" | "PNG" | "BMP" }): number[]
```

1. Das Geräte-Plugin meldet `DeviceType() → "lcd"` und ruft einmal `LCD.initialize()` mit der Displaygröße auf.
2. SignalRGB rendert das vom Benutzer gewählte Face in einen Viewport genau dieser Größe.
3. Das Plugin holt pro Frame das fertige Bild mit `LCD.getFrame()` als JPEG-, PNG- oder BMP-Bytes und überträgt
   es auf die Hardware.

Alles, was das Face betrifft, passiert in SignalRGB selbst und steht damit jedem LCD-Gerät automatisch zur
Verfügung: Auswahl, Einstellungen, Sensoren, „Now Playing“, „Custom Text“, Face-Drehung (2.5.55),
LCD-Idle-Canvas sowie das Speichern der Auswahl.

## 2. Ist die Infrastruktur für Drittanbieter-LCDs zugänglich?

**Ja, über die offizielle Plugin-Schnittstelle.** `@SignalRGB/lcd` ist ein öffentliches Modul der Plugin-API.
Die offiziellen Plugins nutzen es identisch für Geräte verschiedener Hersteller:

| Plugin (offizielles Repo) | Aufruf |
|---|---|
| `Corsair_ICUE_Link_LCD.js` | `LCD.initialize({ width: 480, height: 480 })`, `LCD.getFrame({ format: "JPEG" })` |
| `Corsair_Elite_Capellix_LCD.js` | dto. |
| `Corsair_XC7_LCD.js` | dto. |
| `Lian_Li_Galahad_II_LCD.js` | dto. |

In der Plugin-API gibt es keine Herstellerbeschränkung. Jedes Plugin mit `DeviceType "lcd"` bekommt die
Face-Auswahl. Eine separate, öffentlich zugängliche Library-API, über die ein Plugin selbst Faces laden oder
auflisten könnte, gibt es dagegen nicht. Das ist aber auch nicht nötig, weil SignalRGB das übernimmt.

**Grenzen, die sich bei der Untersuchung gezeigt haben:**

1. **Transport.** Plugins können nur über `HID`, `rawusb` (libusb) und `SMBUS` mit Hardware sprechen, dazu
   kommen Netzwerkmodule. Eine serielle Schnittstelle (COM-Port) gibt es nicht. Das Jungle-Leopard-Display ist
   aber ein USB-CDC-Gerät, also ein virtueller COM-Port. Lösung: Raw-USB-Bulk-Transfers direkt auf das
   CDC-Daten-Interface. Unter Windows setzt das den WinUSB-Treiber voraus, siehe README.
2. **Seitenverhältnis.** `LCD.initialize` nimmt beliebige Breiten und Höhen an, alle offiziellen LCD-Plugins
   nutzen aber 480×480. Ob jede SignalRGB-Version einen 960×480-Viewport exakt so liefert, ist nicht
   dokumentiert. Das Plugin prüft deshalb jedes Bild und gleicht Abweichungen aus (siehe 4.).
3. **Bildformat.** `getFrame` liefert JPEG, PNG oder BMP. Welche JPEG-Variante SignalRGB erzeugt (Unterabtastung,
   progressiv), ist nicht dokumentiert. Das Display verlangt Baseline-JPEG mit 4:2:0.

## 3. Das Display

Das Protokoll stammt aus dem Reverse Engineering der Hersteller-App durch
[senesees](https://github.com/senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD) und
[yughias](https://github.com/yughias/JL-LCD-AIO). Verifiziert wurde es dort mit Firmware 3.1, Modell
`TXW818-ST7701S-5.5inch-hor`.

| Aspekt | Wert |
|---|---|
| USB | `33C3:7788`, CherryUSB-CDC-ACM („CherryUSB CDC DEMO“). Generische Demo-ID, die auch andere Displays verwenden |
| Endpunkte | Interface 0: CDC Communication (Interrupt `0x83`); Interface 1: CDC Data (Bulk-OUT `0x02`, Bulk-IN `0x81`). Laut CherryUSB-CDC-Template |
| Steuerframes | `55 AA` · Gesamtlänge u16 LE · Befehl · Nutzdaten · Summe16 LE |
| Befehle | `0x03` Helligkeit 0–100 · `0x06` Geräteinfo (JSON) · `0x11` Live-Modus · `0x21` Close (ab FW 3.1) |
| Bildframes | Länge u32 LE · JPEG · Summe16 LE (über Länge + JPEG) |
| Bildformat | 960×480, Baseline-JPEG, YCbCr 4:2:0, ≤ 80 KB |
| Timing | `0x11` mindestens alle ~1,5 s wiederholen; ein Standbild regelmäßig neu senden (Panel zeichnet erst, wenn Folgedaten kommen) |
| Initialisierung | `FF D9 FF D9` (bricht ein halbes Bild ab), Pause, `00 00 00 00`; CDC-Leitung mit DTR/RTS |

## 4. Aufbau des Plugins

```
Initialize: CDC-Leitung (SET_LINE_CODING, DTR/RTS) → Flush → 0x06 Geräteinfo prüfen
            → Helligkeit → 0x11 Live → LCD.initialize(Viewport)
Render:     Keep-alive (≤ 1 s) → Frame-Limit → Frame-Pipeline → Bild senden
Shutdown:   optional Hintergrundbeleuchtung aus → Flush → 0x21 Close (nur FW ≥ 3.1)
```

**Frame-Pipeline**

1. **Durchreichen (Normalfall):** `getFrame({format: "JPEG"})` liefert ein Bild, das bereits 960×480, Baseline,
   4:2:0 und ≤ 80 KB ist. Es wird byte-genau übertragen, ohne Neukodierung und ohne zusätzlichen Qualitätsverlust.
2. **Umwandeln:** Bei inkompatiblem JPEG, z. B. 4:4:4, progressiv oder falscher Größe, sowie bei Drehung oder
   quadratischem Layout holt das Plugin `getFrame({format: "BMP"})`. Es dekodiert die Rohpixel, setzt sie
   zusammen (einpassen, zentrieren, drehen, Füllfarbe) und kodiert sie mit einem eingebauten Baseline-JPEG-Encoder
   (4:2:0). Die Qualität wird dabei an das 80-KB-Limit angepasst. Der Plugin-Sandbox steht kein Bild-Codec zur
   Verfügung, daher ist der Encoder Teil des Plugins. Gegen libjpeg geprüft liegt er bei gleicher Qualitätsstufe
   innerhalb von ±0,4 dB PSNR.
3. **Statusbildschirm:** Statt einer leeren Anzeige rendert das Plugin eine Erklärung mit einer eigenen
   Bitmap-Schrift (Deutsch/Englisch) und sendet sie als JPEG. Parallel erscheint eine SignalRGB-Benachrichtigung.

Da `33C3:7788` eine generische ID ist, wertet das Plugin die Geräteinfo aus. Nur wenn das Gerät ausdrücklich eine
andere Auflösung meldet, sendet es keine Bilder und zeigt eine Meldung. Antwortet das Gerät nicht oder ist das
Format unbekannt, läuft es normal weiter.

## 5. Abgleich mit den Anforderungen

| Anforderung | Umsetzung |
|---|---|
| 1. Display erscheint als unterstütztes LCD-Gerät | `DeviceType "lcd"`, `Type "rawusb"`, VID/PID `33C3:7788`, Gerätebild |
| 2. Faces direkt aus der offiziellen Library | Offizielles `@SignalRGB/lcd`; SignalRGB rendert das gewählte Library-Face |
| 3. Anpassung an 960×480 | Viewport 960×480 (responsive Faces füllen die Fläche); alternativ originalgetreues 480×480, zentriert; Hochkant 480×960 |
| 4. Animationen, Farben, Texte, dynamische Inhalte | Werden von SignalRGB gerendert; kompatible Bilder gehen unverändert durch; bis 30 fps; 4:2:0 ist das native Format des Panels |
| 5. Auswahl über die SignalRGB-Oberfläche | Standard-Face-Auswahl von SignalRGB; Plugin-Optionen als Geräteeinstellungen |
| 6. Anzeige auf dem Display | USB-Bulk-Übertragung im Herstellerprotokoll inkl. Keep-alive |
| 7. Auswahl bleibt nach Neustart erhalten | Face-Auswahl und Geräteeinstellungen speichert SignalRGB pro Gerät |
| Keine eigene Designbibliothek | Das Plugin enthält keine Faces |
| Fehlermeldung statt leerer Anzeige | Statusbildschirme auf dem Display und SignalRGB-Benachrichtigungen |

## 6. Offene Punkte

* **Hardwaretest ausstehend.** Getestet wurde gegen einen Protokoll-Simulator; die gesendeten Bilder wurden
  unabhängig mit libjpeg dekodiert.
* **WinUSB-Voraussetzung:** Geschlossen aus der Plugin-API (kein serieller Transport, `rawusb` = libusb) und der
  SignalRGB-Dokumentation („USB“/„libusb“-Geräteklasse = rawusb). Ein Test mit SignalRGB selbst steht aus.
* **`Validate` bei `rawusb`:** Offizielle Raw-USB-Plugins exportieren kein `Validate`. Dieses Plugin gibt
  Interface 0 und 1 frei, weil die Bulk-Endpunkte auf Interface 1 liegen. Falls SignalRGB nur Interface 0
  beansprucht, scheitern die Bulk-Transfers. Das Plugin meldet das dann als „Verbindung zum Display unterbrochen“.
* **Feldnamen der Geräteinfo:** Nur der Modellstring ist bekannt; der Parser ist deshalb tolerant.

## Quellen

* SignalRGB-Plugin-API und offizielle LCD-Plugins: <https://gitlab.com/signalrgb/signal-plugins> (Branch `Development`,
  `types/lcd.d.ts`, `types/device.d.ts`, `Plugins/Corsair/Corsair_ICUE_Link_LCD.js`, `Plugins/Lian Li/Lian_Li_Galahad_II_LCD.js`)
* SignalRGB-Dokumentation und Changelogs: <https://docs.signalrgb.com/developer/plugins/>, <https://docs.signalrgb.com/changelogs/>
* Beispiel für Benutzer-Faces: <https://github.com/thetunguskaevent/Guy_Pro_Signal_RGB_LCD_Faces>
* Display-Protokoll: <https://github.com/senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD>, <https://github.com/yughias/JL-LCD-AIO>
* CherryUSB-CDC-ACM-Template: <https://github.com/cherry-embedded/CherryUSB> (`demo/cdc_acm_template.c`)
* Generische USB-ID `33C3:7788`: <https://github.com/mathoudebine/turing-smart-screen-python/issues/965>
