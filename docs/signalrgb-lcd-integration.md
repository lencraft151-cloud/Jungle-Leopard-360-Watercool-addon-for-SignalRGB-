# SignalRGB-LCD-Integration: Untersuchung und Umsetzung

Dieses Dokument hält fest, wie SignalRGB LCD-Faces lädt und rendert, ob diese Infrastruktur für
Drittanbieter-LCDs zugänglich ist, und wie das Plugin darauf aufbaut.

Stand der Untersuchung: November 2026. Grundlage sind die Branches `Development` (Stand 2025-09) und `beta`
(Stand 2026-01) des offiziellen Repos `signalrgb/signal-plugins` und die öffentlichen SignalRGB-Changelogs.

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
LCD.getFrame({ format: "JPEG", quality?: number } | { format: "PNG" | "BMP" | "RGBA" | "RGB" }): number[]
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

1. **Transport.** Das Jungle-Leopard-Display ist ein USB-CDC-Gerät, also ein virtueller COM-Port. Im
   `Development`-Branch konnten Plugins nur über `HID`, `rawusb` (libusb) und `SMBUS` mit Hardware sprechen; die
   Versionen 1.0.x versuchten deshalb Raw-USB, 1.1.0 eine Bridge (siehe 6.). Seit SignalRGB 2.5 gibt es das
   offizielle Modul **`@SignalRGB/serial`** mit `Type() → "serial"` (Branch `beta`: `@SignalRGB/Serial/serial.d.ts`,
   genutzt von `Plugins/Turzx/Turzx_LCD_Controller.js` – ebenfalls ein LCD – und `Plugins/Hyte/CNVS.js`). Darüber
   spricht das Plugin ab 2.0.0 den COM-Port direkt an.
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
Initialize: serial.connect(115200 8N1) → Flush → 0x06 Geräteinfo prüfen (serial.read in 50-ms-Scheiben)
            → Helligkeit → 0x11 Live → LCD.initialize(Viewport)
Render:     Keep-alive (≤ 1 s) → Display aus? schwarzes Bild 1×/s : Frame-Limit → Frame-Pipeline → Bild senden
Fehler:     Port schließen → Benachrichtigung (belegt / unterbrochen / Update nötig) → alle 2 s neu verbinden
Shutdown:   Hintergrundbeleuchtung aus (Standby oder auf Wunsch) → Flush → 0x21 Close (nur FW ≥ 3.1)
            → serial.disconnect(), damit die Hersteller-App das Display wieder übernehmen kann
```

**Frame-Pipeline**

1. **Durchreichen (Normalfall):** `getFrame({format: "JPEG"})` liefert ein Bild, das bereits 960×480, Baseline,
   4:2:0 und ≤ 80 KB ist. Es wird byte-genau übertragen, ohne Neukodierung und ohne zusätzlichen Qualitätsverlust.
2. **Umwandeln:** Bei inkompatiblem JPEG, z. B. 4:4:4, progressiv oder falscher Größe, sowie bei Drehung oder
   quadratischem Layout holt das Plugin Rohpixel, bevorzugt `getFrame({format: "RGB"})`, sonst
   `getFrame({format: "BMP"})`. Es setzt sie
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
| 1. Display erscheint als unterstütztes LCD-Gerät | `DeviceType "lcd"`, `Type "serial"`, VID/PID `33C3:7788`, Gerätebild |
| 2. Faces direkt aus der offiziellen Library | Offizielles `@SignalRGB/lcd`; SignalRGB rendert das gewählte Library-Face |
| 3. Anpassung an 960×480 | Viewport 960×480 (responsive Faces füllen die Fläche); alternativ originalgetreues 480×480, zentriert; Hochkant 480×960 |
| 4. Animationen, Farben, Texte, dynamische Inhalte | Werden von SignalRGB gerendert; kompatible Bilder gehen unverändert durch; bis 30 fps; 4:2:0 ist das native Format des Panels |
| 5. Auswahl über die SignalRGB-Oberfläche | Standard-Face-Auswahl von SignalRGB; Plugin-Optionen als Geräteeinstellungen |
| 6. Anzeige auf dem Display | Offizielles `@SignalRGB/serial` auf den COM-Port des Displays, Herstellerprotokoll inkl. Keep-alive; Display an/aus als Geräteeinstellung |
| 7. Auswahl bleibt nach Neustart erhalten | Face-Auswahl und Geräteeinstellungen speichert SignalRGB pro Gerät |
| Keine eigene Designbibliothek | Das Plugin enthält keine Faces |
| Fehlermeldung statt leerer Anzeige | Statusbildschirme auf dem Display und SignalRGB-Benachrichtigungen |

## 6. Offene Punkte

* **Hardwaretest ausstehend.** Getestet wurde gegen einen Protokoll-Simulator; die gesendeten Bilder wurden
  unabhängig mit libjpeg dekodiert.
* **WinUSB-Voraussetzung:** Geschlossen aus der Plugin-API (kein serieller Transport, `rawusb` = libusb) und der
  SignalRGB-Dokumentation („USB“/„libusb“-Geräteklasse = rawusb). Erste Rückmeldung vom echten System: SignalRGB
  erkennt das Gerät auch **ohne** WinUSB, das Display bleibt dann aber leer. Das passt dazu, dass libusb unter
  Windows alle Geräte auflistet, Geräte am seriellen Treiber aber nicht öffnen kann. Seit Version 1.0.1
  protokolliert das Plugin beim Start die Rückgabewerte der USB-Aufrufe, wertet negative libusb-Fehlercodes als
  Fehler und meldet „Display antwortet nicht“, wenn keine Antwort auf die Geräteinfo kommt.
* **Befund am echten Gerät (Plugin 1.0.2):** Hardware-ID `USB\VID_33C3&PID_7788&REV_0200`, Zadig-Name
  „MONITOR“, kein Composite-Gerät. Deskriptor: `if0 cls 0x02 [0x81 int]; if1 cls 0x0a [0x01 bulk, 0x82 bulk]`,
  also **andere Endpunkte als das CherryUSB-Template** (OUT `0x01`, IN `0x82`). Mit WinUSB funktionierten
  Control-Transfers (`line coding: array(7)`), jeder `bulk_transfer` lieferte aber `array(-1)`.
* **`Validate` bei `rawusb`:** Laut SignalRGB-Doku öffnet `Validate()` Endpunkte, aktiv ist aber immer nur einer
  (`device.set_endpoint()` wechselt). Bis 1.0.2 gab das Plugin Interface 0 und 1 frei; vermutlich war damit das
  endpunktlose Interface 0 aktiv. Ab 1.0.3 wird nur Interface 1 freigegeben (wie im offiziellen ASUS-Ryuo-Plugin),
  Interface 1 per `set_endpoint` aktiviert, sofern SignalRGB es auflistet, und beim Start werden `bulk_transfer`
  sowie das generische `write`/`read` ausprobiert. Die Diagnose-Benachrichtigung zeigt das Ergebnis (`Probe:`).
* **Befund am echten Gerät (Plugin 1.0.3):** `Validate()` wird bei `rawusb` nicht aufgerufen (`Validate: -`),
  `getHidEndpoints()` liefert nichts, `device.write()` ist bei Raw-USB nicht verfügbar („Selected IO Protocol isn't
  HID, function is not available!“) und `bulk_transfer` auf Interface 1 liefert weiter `array(-1)`. Die
  Plugin-API bietet keine Möglichkeit, ein anderes Interface zu öffnen. **SignalRGB kann dieses Display also nicht
  direkt beschreiben.**
* **Lösung ab Plugin 1.1.0 – Bridge:** Plugins dürfen UDP senden (`device.addFeature("udp")` bzw. `@SignalRGB/udp`).
  Schlägt der direkte USB-Weg fehl, schickt das Plugin den fertigen Byte-Strom in Datagrammen (`JLB1`-Kopf,
  max. 8 KB Nutzdaten) an `127.0.0.1:48960`. Die „Jungle Leopard LCD Bridge“ (`bridge/`, C# 5 + PowerShell, ohne
  Admin-Rechte) setzt die Nachrichten zusammen und schreibt sie auf den COM-Port des Displays (Suche über
  `VID_33C3&PID_7788` in der Registry). Ihren Zustand meldet sie jede Sekunde an `127.0.0.1:48961`; das Plugin
  zeigt daraus Benachrichtigungen (Bridge fehlt, kein COM-Port, Port belegt). Dafür muss das Display den normalen
  Windows-Treiber (usbser, COM-Port) behalten.
* **Lösung ab Plugin 2.0.0 – offizielles Serial-Modul:** Bei der weiteren Recherche fand sich im `beta`-Branch
  von `signal-plugins` das Modul `@SignalRGB/serial` (`connect({baudRate, dataBits, stopBits, parity})`,
  `write(number[]) → number`, `read(maxBytes?, timeout?)`, `readAll()`, `isConnected()`, `disconnect()`,
  `getPortName()`, `getDeviceInfo()`), eingeführt mit SignalRGB 2.5 (Changelogs: HYTE CNVS ab 2.5.26/2.5.45,
  Turzx-LCD ab 2.5.39). SignalRGB ordnet Plugins mit `Type "serial"` den COM-Port über VID/PID zu; `connect()`
  braucht deshalb keinen Portnamen (so macht es auch das offizielle Turzx-Plugin). Damit sind WinUSB und Bridge
  überflüssig. Die Bridge wurde entfernt; `bridge/uninstall.ps1` bleibt, um eine installierte Bridge zu entfernen.
* **DTR:** Das Serial-Modul bietet keine Steuerung von DTR/RTS. CherryUSB-Firmwares nehmen Daten auch ohne DTR an,
  senden aber eventuell keine Antwort. Antwortet das Display nicht auf die Geräteinfo, läuft das Plugin daher
  normal weiter (nur in der Diagnose vermerkt).
* **Offen:** Ob das Gerät mit Revision 2.00 dasselbe Bildprotokoll spricht wie die von senesees/yughias
  dokumentierte Firmware 3.1 (gleiche USB-ID `33C3:7788`, laut senesees `jl_device.cpp`), zeigt erst der Test
  am echten Gerät.
* **Feldnamen der Geräteinfo:** Nur der Modellstring ist bekannt; der Parser ist deshalb tolerant.

## Quellen

* SignalRGB-Plugin-API und offizielle LCD-Plugins: <https://gitlab.com/signalrgb/signal-plugins> (Branch `Development`,
  `types/lcd.d.ts`, `types/device.d.ts`, `Plugins/Corsair/Corsair_ICUE_Link_LCD.js`, `Plugins/Lian Li/Lian_Li_Galahad_II_LCD.js`;
  Branch `beta`: `@SignalRGB/Serial/serial.d.ts`, `@SignalRGB/lcd/lcd.d.ts`, `Plugins/Turzx/Turzx_LCD_Controller.js`,
  `Plugins/Hyte/CNVS.js`)
* SignalRGB-Doku zum Serial-Modul: <https://docs.signalrgb.com/developer/plugins/advanced-communication/>
* SignalRGB-Dokumentation und Changelogs: <https://docs.signalrgb.com/developer/plugins/>, <https://docs.signalrgb.com/changelogs/>
* Beispiel für Benutzer-Faces: <https://github.com/thetunguskaevent/Guy_Pro_Signal_RGB_LCD_Faces>
* Display-Protokoll: <https://github.com/senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD>, <https://github.com/yughias/JL-LCD-AIO>
* CherryUSB-CDC-ACM-Template: <https://github.com/cherry-embedded/CherryUSB> (`demo/cdc_acm_template.c`)
* Generische USB-ID `33C3:7788`: <https://github.com/mathoudebine/turing-smart-screen-python/issues/965>
