// End-to-end lifecycle tests: SignalRGB host (mocked) -> plugin -> COM port byte stream -> fake panel firmware.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import LCD from "@SignalRGB/lcd";
import * as Plugin from "../Jungle_Leopard_LCD.js";
import { FakePanel, isPanelReady } from "./helpers/fake-panel.mjs";
import { installClock, installDevice, setProperties } from "./helpers/device-mock.mjs";
import { makeBmp24, makeTestPattern } from "./helpers/images.mjs";

const I = Plugin._internals;
const fixture = (name) => Array.from(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const NATIVE = fixture("pil-420-960x480.jpg");
const JPEG_444 = fixture("pil-444-960x480.jpg");
const DEFAULT_PROPS = Object.fromEntries(Plugin.ControllableParameters().map((p) => [p.property, p.default]));

const bmpCache = new Map();

function bmpFor(width, height) {
	const key = `${width}x${height}`;

	if (!bmpCache.has(key)) {
		bmpCache.set(key, makeBmp24(makeTestPattern(width, height), width, height));
	}

	return bmpCache.get(key);
}

/**
 * Behaves like SignalRGB rendering a face: JPEG, BMP or RGB of the viewport requested via LCD.initialize.
 * RGB is off by default, as in SignalRGB builds that only offer BMP.
 */
function faceProvider({ jpeg = NATIVE, bmp = true, rgb = false } = {}) {
	return (options) => {
		if (options.format === "JPEG") {
			return typeof jpeg === "function" ? jpeg() : jpeg;
		}

		const viewport = LCD.initializeCalls.at(-1);

		if (options.format === "RGB") {
			return rgb ? Array.from(makeTestPattern(viewport.width, viewport.height)) : [];
		}

		return bmp ? bmpFor(viewport.width, viewport.height) : [];
	};
}

function boot({ panel: panelOptions, props = {}, face = faceProvider(), serial = {} } = {}) {
	LCD.reset();
	LCD.frameProvider = face;

	const clock = installClock();
	const panel = new FakePanel(panelOptions);
	panel.clock = clock;

	const dev = installDevice(panel, clock, serial);
	setProperties({ ...DEFAULT_PROPS, ...props });
	Plugin.Initialize();

	return { clock, panel, dev };
}

function run(ctx, ms, step = 33) {
	for (let t = 0; t < ms; t += step) {
		Plugin.Render();
		ctx.clock.advance(step);
	}
}

const DIAGNOSIS_TITLES = ["Jungle Leopard LCD - Diagnose", "Jungle Leopard LCD - diagnostics"];

/** Active alerts except the informational startup diagnosis. */
function problemAlerts(dev) {
	return dev.activeAlerts().filter((a) => !DIAGNOSIS_TITLES.includes(a.title));
}

function activeTitles(dev) {
	return problemAlerts(dev).map((a) => a.title);
}

function diagnosis(dev) {
	return dev.activeAlerts().find((a) => DIAGNOSIS_TITLES.includes(a.title));
}

function assertCleanStream(panel) {
	assert.deepEqual(panel.errors, [], "every byte sent must form a valid frame");

	for (const image of panel.images()) {
		assert.ok(image.ready, "every image must be 960x480 baseline 4:2:0 <= 80 KB");
	}
}

test("exports satisfy SignalRGB's plugin validator rules", () => {
	assert.equal(Plugin.DeviceType(), "lcd");
	assert.equal(Plugin.Type(), "serial");
	assert.equal(Plugin.VendorId(), 0x33C3);
	assert.equal(Plugin.ProductId(), 0x7788);
	assert.equal(Plugin.ImageUrl, undefined, "exactly one image export");
	assert.deepEqual([...Buffer.from(Plugin.Image(), "base64").subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	assert.equal(Plugin.LedNames().length, Plugin.LedPositions().length);
	assert.ok(Plugin.Size().every((v) => v >= 1));
	assert.ok(Array.isArray(Plugin.ConflictingProcesses()));

	for (const param of Plugin.ControllableParameters()) {
		for (const field of ["property", "label", "description", "type", "default"]) {
			assert.ok(param[field] !== undefined && param[field] !== "", `${param.property}.${field}`);
		}

		assert.equal(typeof Plugin[`on${param.property}Changed`], "function", `on${param.property}Changed`);

		if (param.type === "combobox") {
			assert.ok(param.values.includes(param.default), param.property);
		} else if (param.type === "number") {
			assert.ok(Number(param.min) <= Number(param.default) && Number(param.default) <= Number(param.max), param.property);
		} else if (param.type === "color") {
			assert.match(param.default, /^#[0-9a-f]{6}$/i);
		}
	}

	assert.equal(Plugin.Validate({ interface: 0 }), true, "the panel's COM port");
	assert.equal(Plugin.Validate({ interface: -1 }), true);
	assert.equal(Plugin.ControllableParameters()[0].property, "displayEnabled", "the on/off switch comes first");
});

test("Initialize opens the COM port at 115200 8N1, identifies the panel and requests a 960x480 face viewport", () => {
	const { panel, dev } = boot();

	assert.deepEqual(dev.port.connectCalls, [{ baudRate: 115200, dataBits: 8, stopBits: "One", parity: "None" }],
		"the options SignalRGB's own serial plugins use, no port name (SignalRGB binds the device's port)");
	assert.equal(dev.port.connected, true);

	const sequence = panel.events.map((e) => (e.type === "control" ? `cmd${e.command.toString(16)}` : e.type));
	assert.deepEqual(sequence, ["resync", "zeros", "cmd6", "cmd3", "cmd11"]);
	assert.deepEqual(panel.controls(0x03)[0].payload, [100]);
	assert.deepEqual(LCD.initializeCalls, [{ width: 960, height: 480 }]);
	assert.equal(I.getState().panelInfo.model, "TXW818-ST7701S-5.5inch-hor");
	assert.equal(I.getState().panelInfo.version, 3.1);
	assert.deepEqual(activeTitles(dev), []);
	assertCleanStream(panel);
});

test("a compatible SignalRGB face frame reaches the panel byte-for-byte, without re-encoding", () => {
	const ctx = boot();
	run(ctx, 200);

	const images = ctx.panel.images();
	assert.ok(images.length >= 1);
	assert.deepEqual(images[0].jpeg, NATIVE);
	assert.ok(LCD.frameRequests.every((f) => f === "JPEG"), "no raw frame needed");
	assert.deepEqual(activeTitles(ctx.dev), []);
	assertCleanStream(ctx.panel);
});

test("a face frame the panel cannot decode (4:4:4) is converted on the host and still shown", () => {
	const ctx = boot({ face: faceProvider({ jpeg: JPEG_444 }) });
	run(ctx, 300);

	assert.ok(ctx.panel.images().length >= 1);
	assert.ok(LCD.frameRequests.includes("BMP"));
	assert.ok(ctx.dev.logs.some((l) => l.includes("converted on the host")));
	assert.deepEqual(activeTitles(ctx.dev), []);
	assertCleanStream(ctx.panel);
});

test("Original Square layout renders the face at 480x480 and composes it onto the panel", () => {
	const ctx = boot({ props: { faceLayout: I.LAYOUT_SQUARE, sideFillColor: "#203040" } });
	run(ctx, 200);

	assert.deepEqual(LCD.initializeCalls.at(-1), { width: 480, height: 480 });
	assert.ok(ctx.panel.images().length >= 1);
	assertCleanStream(ctx.panel);
});

test("portrait mounting asks SignalRGB for a 480x960 face and rotates it for the panel", () => {
	const ctx = boot({ props: { mountOrientation: "Portrait (Rotated Right)" } });
	run(ctx, 200);

	assert.deepEqual(LCD.initializeCalls.at(-1), { width: 480, height: 960 });
	assert.ok(ctx.panel.images().length >= 1);
	assertCleanStream(ctx.panel);
});

test("changing the layout at runtime re-initializes the face viewport", () => {
	const ctx = boot();
	run(ctx, 100);
	setProperties({ faceLayout: I.LAYOUT_SQUARE });
	Plugin.onfaceLayoutChanged();

	assert.deepEqual(LCD.initializeCalls.at(-1), { width: 480, height: 480 });

	setProperties({ faceLayout: I.LAYOUT_FULL });
	run(ctx, 100);

	assert.deepEqual(LCD.initializeCalls.at(-1), { width: 960, height: 480 });
	assertCleanStream(ctx.panel);
});

test("without a face the panel shows an explanation (German) instead of staying blank", () => {
	const ctx = boot({ face: () => [] });
	run(ctx, 1000);
	assert.equal(ctx.panel.images().length, 0, "short grace period first");

	run(ctx, 1500);
	assert.ok(ctx.panel.images().length >= 1);
	assert.deepEqual(activeTitles(ctx.dev), ["Kein LCD-Face aktiv"]);
	assert.equal(problemAlerts(ctx.dev)[0].priority, 0);

	LCD.frameProvider = faceProvider();
	run(ctx, 300);
	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.deepEqual(ctx.panel.images().at(-1).jpeg, NATIVE);
	assertCleanStream(ctx.panel);
});

test("messages follow the Message Language setting", () => {
	const ctx = boot({ face: () => [], props: { messageLanguage: "English" } });
	run(ctx, 2000);

	assert.deepEqual(activeTitles(ctx.dev), ["No LCD face active"]);
});

test("an incompatible face without raw-frame support produces a clear error naming the reason", () => {
	const ctx = boot({ face: faceProvider({ jpeg: JPEG_444, bmp: false }) });
	run(ctx, 300);

	const alert = problemAlerts(ctx.dev)[0];
	assert.equal(alert.title, "Face nicht kompatibel");
	assert.ok(alert.description.includes("Farbunterabtastung ist nicht 4:2:0"));
	assert.ok(ctx.panel.images().length >= 1, "the explanation is shown on the panel");
	assertCleanStream(ctx.panel);
});

test("rotation without raw-frame support explains which settings work", () => {
	const ctx = boot({ face: faceProvider({ bmp: false }), props: { mountOrientation: "Landscape (Upside Down)" } });
	run(ctx, 300);

	assert.deepEqual(activeTitles(ctx.dev), ["Layout nicht verfügbar"]);
	assertCleanStream(ctx.panel);
});

test("render errors surface on the panel and as a notification, then clear", () => {
	const ctx = boot({ face: () => { throw new Error("face crashed"); } });
	run(ctx, 200);

	const alert = problemAlerts(ctx.dev)[0];
	assert.equal(alert.title, "Darstellungsfehler");
	assert.ok(alert.description.includes("face crashed"));
	assert.ok(ctx.panel.images().length >= 1);

	LCD.frameProvider = faceProvider();
	run(ctx, 200);
	assert.deepEqual(activeTitles(ctx.dev), []);
	assertCleanStream(ctx.panel);
});

test("live mode is kept alive well within the panel's 1.5 s timeout", () => {
	const ctx = boot();
	run(ctx, 6000, 50);

	const lives = ctx.panel.controls(0x11).map((e) => e.at);
	assert.ok(lives.length >= 6);

	for (let i = 1; i < lives.length; i++) {
		assert.ok(lives[i] - lives[i - 1] <= 1100, `gap ${lives[i] - lives[i - 1]} ms`);
	}
});

test("an unchanged face is refreshed every 250 ms instead of on every tick", () => {
	const ctx = boot();
	run(ctx, 2000, 20);

	const count = ctx.panel.images().length;
	assert.ok(count >= 7 && count <= 10, `${count} frames in 2 s`);
});

test("animated faces are limited by Max Frame Rate", () => {
	const encoder = new I.JpegEncoder();
	const frames = [1, 2].map((seed) => Array.from(encoder.encode(makeTestPattern(960, 480, seed), 960, 480, 80)));
	let n = 0;
	const ctx = boot({ props: { maxFps: "10" }, face: faceProvider({ jpeg: () => frames[n++ % 2] }) });
	run(ctx, 2000, 5);

	const count = ctx.panel.images().length;
	assert.ok(count >= 18 && count <= 21, `${count} frames in 2 s at 10 fps`);
	assertCleanStream(ctx.panel);
});

test("LCD Backlight changes are applied immediately", () => {
	const ctx = boot();
	setProperties({ lcdBrightness: "40" });
	Plugin.onlcdBrightnessChanged();

	assert.deepEqual(ctx.panel.controls(0x03).at(-1).payload, [40]);
});

test("a different display behind the generic 33C3:7788 ID is left alone", () => {
	const ctx = boot({ panel: { infoReply: { model: "HT-8.8inch", width: 462, height: 1920 } } });
	run(ctx, 500);

	const alert = problemAlerts(ctx.dev)[0];
	assert.equal(alert.title, "Nicht unterstütztes Display");
	assert.ok(alert.description.includes("462x1920"));
	assert.deepEqual(LCD.initializeCalls, []);
	assert.equal(ctx.panel.images().length, 0);
	assert.equal(ctx.panel.controls(0x11).length, 0);
	assert.equal(ctx.dev.port.connected, false, "the COM port is released again");
});

test("a panel that does not answer the info request still gets the face, without a false alarm", () => {
	const ctx = boot({ panel: { answerInfo: false } });
	run(ctx, 200);

	assert.equal(I.getState().panelInfo, null);
	assert.ok(ctx.panel.images().length >= 1);
	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.ok(diagnosis(ctx.dev).description.includes("Reply: none (no reply (0 B))"), diagnosis(ctx.dev).description);
	assertCleanStream(ctx.panel);
});

test("startup diagnosis: shown as a notification and written to the log file", () => {
	const ctx = boot();
	const report = diagnosis(ctx.dev);

	assert.ok(report, "diagnosis notification");
	assert.equal(report.title, "Jungle Leopard LCD - Diagnose");
	assert.equal(report.priority, 0);
	assert.match(report.description, /^Plugin 2\.\d+\.\d+ \| Serial: yes \| /);

	for (const part of [
		"Port: COM5 (33C3:7788, USB Serial Device)",
		"Connect: open (undefined)",
		"Write: number 4",
		"TXW818-ST7701S-5.5inch-hor, FW 3.1",
	]) {
		assert.ok(report.description.includes(part), `missing "${part}" in: ${report.description}`);
	}

	assert.ok(ctx.dev.logs.some((l) => l.includes(`Diagnosis: ${report.description}`)));
});

test("the startup diagnosis can be switched off", () => {
	const ctx = boot({ props: { startupReport: "false" } });

	assert.equal(diagnosis(ctx.dev), undefined);
	assert.ok(ctx.dev.logs.some((l) => l.includes("Diagnosis: Plugin")), "still logged");
});

test("Display On switch: off means backlight 0 and black frames while live mode continues; on restores the face", () => {
	const ctx = boot({ props: { lcdBrightness: "70" } });
	run(ctx, 300);

	setProperties({ displayEnabled: false });
	Plugin.ondisplayEnabledChanged();

	assert.deepEqual(ctx.panel.controls(0x03).at(-1).payload, [0], "backlight off at once");

	const before = ctx.panel.images().length;
	const livesBefore = ctx.panel.controls(0x11).length;
	const requestsBefore = LCD.frameRequests.length;
	run(ctx, 3000);

	const dark = ctx.panel.images().slice(before);
	assert.ok(dark.length >= 2 && dark.length <= 4, `${dark.length} black frames in 3 s`);
	assert.ok(dark.every((image) => image.ready && image.jpeg.length < 20000), "small black frames");
	assert.ok(ctx.panel.controls(0x11).length - livesBefore >= 2, "keep-alive continues, so the panel's animation stays away");
	assert.equal(LCD.frameRequests.length, requestsBefore, "no face rendering while off");

	setProperties({ displayEnabled: true });
	run(ctx, 300);

	assert.deepEqual(ctx.panel.controls(0x03).at(-1).payload, [70], "brightness restored");
	assert.deepEqual(ctx.panel.images().at(-1).jpeg, NATIVE, "the face is back");
	assertCleanStream(ctx.panel);
});

test("Display On off at start: the panel starts dark", () => {
	const ctx = boot({ props: { displayEnabled: "false" } });
	run(ctx, 1500);

	assert.deepEqual(ctx.panel.controls(0x03).map((e) => e.payload[0]), [0]);
	assert.ok(ctx.panel.images().length >= 1);
	assert.ok(ctx.panel.images().every((image) => image.jpeg.length < 20000));
});

test("COM port held by another program: a clear alert naming the port, quiet retries, recovery once it is free", () => {
	const ctx = boot({ serial: { busy: true } });
	run(ctx, 7000);

	const alert = problemAlerts(ctx.dev).find((a) => a.title === "COM-Port des Displays belegt");
	assert.ok(alert, `alerts: ${activeTitles(ctx.dev)}`);
	assert.ok(alert.description.includes("COM5"));
	assert.ok(alert.description.includes("Hersteller-App"));
	assert.ok(diagnosis(ctx.dev).description.includes("Error: COM5 could not be opened"), diagnosis(ctx.dev).description);
	assert.ok(ctx.dev.port.connectCalls.length >= 3, "retried");
	assert.equal(ctx.dev.logs.filter((l) => l.includes("Reconnect failed")).length, 1, "retries are not logged every time");
	assert.equal(ctx.panel.events.length, 0);

	ctx.dev.port.busy = false;
	run(ctx, 2500);

	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.ok(ctx.panel.images().length >= 1);
	assertCleanStream(ctx.panel);
});

test("connect() throwing (e.g. access denied) is reported as a busy port, too", () => {
	const ctx = boot({ serial: { connectThrows: true } });

	assert.deepEqual(activeTitles(ctx.dev), ["COM-Port des Displays belegt"]);
	assert.ok(diagnosis(ctx.dev).description.includes("Connect: failed (Access is denied.)"));
});

test("a SignalRGB build without the serial module asks for an update instead of failing silently", () => {
	const ctx = boot({ serial: { missing: ["connect", "write", "isConnected"] } });
	run(ctx, 3000);

	assert.deepEqual(activeTitles(ctx.dev), ["SignalRGB-Update nötig"]);
	assert.ok(diagnosis(ctx.dev).description.includes("Serial: missing"));
});

test("write failures raise an alert, the port is reopened and the stream resumes cleanly", () => {
	const ctx = boot();
	run(ctx, 200);
	ctx.dev.port.failWrites = true;
	run(ctx, 500);

	assert.deepEqual(activeTitles(ctx.dev), ["Verbindung zum Display unterbrochen"]);
	assert.ok(problemAlerts(ctx.dev)[0].description.includes("write failed (number -1)"));

	const connects = ctx.dev.port.connectCalls.length;
	ctx.dev.port.failWrites = false;
	const sent = ctx.panel.images().length;
	run(ctx, 2500);

	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.ok(ctx.dev.port.connectCalls.length > connects, "the port was opened again");
	assert.ok(ctx.panel.images().length > sent);
	assertCleanStream(ctx.panel);
});

test("unplugging and replugging the display: alert while it is gone, then it comes back on its own", () => {
	const ctx = boot();
	run(ctx, 200);
	ctx.dev.port.unplug();
	run(ctx, 3000);

	assert.ok(activeTitles(ctx.dev).length === 1, `alerts: ${activeTitles(ctx.dev)}`);

	ctx.dev.port.busy = false;
	const sent = ctx.panel.images().length;
	run(ctx, 2500);

	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.ok(ctx.panel.images().length > sent);
	assertCleanStream(ctx.panel);
});

test("partial writes are completed, so frames still arrive intact", () => {
	const ctx = boot({ serial: { shortWrites: true } });
	run(ctx, 300);

	assert.ok(ctx.panel.images().length >= 1);
	assert.deepEqual(ctx.panel.images()[0].jpeg, NATIVE);
	assertCleanStream(ctx.panel);
});

test("write() results other than a byte count (undefined, true, 0 while open) are not treated as errors", () => {
	for (const writeResult of [undefined, true, 0]) {
		const ctx = boot({ serial: { writeResult } });
		run(ctx, 300);

		assert.deepEqual(activeTitles(ctx.dev), [], `writeResult ${writeResult}`);
		assert.ok(ctx.panel.images().length >= 1);
		assertCleanStream(ctx.panel);
	}
});

test("without read support the panel is not identified, but frames are still sent", () => {
	const ctx = boot({ serial: { missing: ["read", "readAll"] } });
	run(ctx, 300);

	assert.equal(I.getState().panelInfo, null);
	assert.ok(diagnosis(ctx.dev).description.includes("Reply: none (read not supported)"));
	assert.ok(ctx.panel.images().length >= 1);
	assert.deepEqual(activeTitles(ctx.dev), []);
});

test("the info reply is read in short slices, never blocking the render thread for long", () => {
	const ctx = boot();

	assert.ok(ctx.dev.port.readCalls.length >= 1);
	assert.ok(ctx.dev.port.readCalls.every((c) => c.maxBytes === 512 && c.timeout === 50));
});

test("raw RGB frames are used where SignalRGB offers them (no BMP needed)", () => {
	const ctx = boot({ face: faceProvider({ rgb: true, bmp: false }), props: { faceLayout: I.LAYOUT_SQUARE } });
	run(ctx, 300);

	assert.ok(LCD.frameRequests.includes("RGB"));
	assert.ok(!LCD.frameRequests.includes("BMP"));
	assert.ok(ctx.panel.images().length >= 1);
	assert.deepEqual(activeTitles(ctx.dev), []);
	assertCleanStream(ctx.panel);
});

test("shutdown releases the panel and frees the COM port; Close (0x21) only on firmware 3.1+", () => {
	const ctx = boot();
	run(ctx, 100);
	Plugin.Shutdown(false);

	const tail = ctx.panel.events.slice(-2).map((e) => (e.type === "control" ? e.command : e.type));
	assert.deepEqual(tail, ["resync", 0x21]);
	assert.ok(!ctx.panel.controls(0x03).some((e) => e.payload[0] === 0));
	assert.equal(ctx.dev.port.connected, false, "port freed for the vendor app");

	const dark = boot({ props: { shutdownBehavior: "Backlight Off" }, panel: { answerInfo: false } });
	run(dark, 100);
	Plugin.Shutdown(false);

	assert.deepEqual(dark.panel.controls(0x03).at(-1).payload, [0]);
	assert.equal(dark.panel.controls(0x21).length, 0, "firmware unknown: no Close");

	const before = dark.panel.events.length;
	run(dark, 500);
	assert.equal(dark.panel.events.length, before, "nothing is sent after shutdown");
});

test("system suspend always switches the backlight off", () => {
	const ctx = boot();
	run(ctx, 100);
	Plugin.Shutdown(true);

	assert.deepEqual(ctx.panel.controls(0x03).at(-1).payload, [0]);
	assert.equal(ctx.dev.port.connected, false);
});

test("frames whose length collides with the 55 AA magic are still received as images", () => {
	const encoder = new I.JpegEncoder();
	const base = Array.from(encoder.encode(makeTestPattern(960, 480), 960, 480, 85));
	const filler = 0xAA55 - base.length - 4;
	const crafted = [0xFF, 0xD8, 0xFF, 0xFE, (filler + 2) >> 8, (filler + 2) & 0xFF, ...new Array(filler).fill(0x20), ...base.slice(2)];

	assert.equal(crafted.length, 0xAA55);
	assert.ok(isPanelReady(crafted));

	const ctx = boot({ face: faceProvider({ jpeg: crafted }) });
	run(ctx, 100);

	assert.equal(ctx.panel.images()[0].jpeg.length, 0xAA55 + 5);
	assert.deepEqual(ctx.panel.controls().map((e) => e.command).filter((c) => ![0x03, 0x06, 0x11].includes(c)), []);
	assertCleanStream(ctx.panel);
});

test("port busy at start, free later: the panel is identified then and the diagnosis shows the working state", () => {
	const ctx = boot({ serial: { busy: true } });
	run(ctx, 1000);

	assert.ok(diagnosis(ctx.dev).description.includes("Error:"));
	assert.equal(I.getState().panelInfo, null);

	ctx.dev.port.busy = false;
	run(ctx, 2500);

	assert.equal(I.getState().panelInfo.model, "TXW818-ST7701S-5.5inch-hor");
	assert.ok(!diagnosis(ctx.dev).description.includes("Error:"), diagnosis(ctx.dev).description);
	assert.ok(diagnosis(ctx.dev).description.includes("Connect: open"));
	assert.deepEqual(activeTitles(ctx.dev), []);
	assertCleanStream(ctx.panel);
});

test("a foreign display found only on reconnect is left alone, too", () => {
	const ctx = boot({ serial: { busy: true }, panel: { infoReply: { model: "HT-8.8inch", width: 462, height: 1920 } } });
	run(ctx, 500);
	ctx.dev.port.busy = false;
	run(ctx, 2500);

	assert.deepEqual(activeTitles(ctx.dev), ["Nicht unterstütztes Display"], "the busy-port alert is gone");
	assert.equal(ctx.panel.images().length, 0);
	assert.equal(ctx.dev.port.connected, false);
});
