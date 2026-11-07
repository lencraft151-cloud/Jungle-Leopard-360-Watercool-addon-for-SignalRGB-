// End-to-end lifecycle tests: SignalRGB host (mocked) -> plugin -> USB byte stream -> fake panel firmware.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import LCD from "@SignalRGB/lcd";
import * as Plugin from "../Jungle_Leopard_LCD.js";
import { FakePanel, isPanelReady } from "./helpers/fake-panel.mjs";
import { cdcConfigDescriptor, installClock, installDevice, setProperties } from "./helpers/device-mock.mjs";
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

/** Behaves like SignalRGB rendering a face: JPEG or BMP of the viewport requested via LCD.initialize. */
function faceProvider({ jpeg = NATIVE, bmp = true } = {}) {
	return (options) => {
		if (options.format === "JPEG") {
			return typeof jpeg === "function" ? jpeg() : jpeg;
		}

		const viewport = LCD.initializeCalls.at(-1);

		return bmp ? bmpFor(viewport.width, viewport.height) : [];
	};
}

function boot({ panel: panelOptions, props = {}, face = faceProvider() } = {}) {
	LCD.reset();
	LCD.frameProvider = face;

	const clock = installClock();
	const panel = new FakePanel(panelOptions);
	panel.clock = clock;

	const dev = installDevice(panel, clock);
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
	assert.equal(Plugin.Type(), "rawusb");
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

	assert.equal(Plugin.Validate({ interface: 1 }), true, "CDC data interface");
	assert.equal(Plugin.Validate({ interface: 0 }), true, "CDC communication interface");
	assert.equal(Plugin.Validate({ interface: 2 }), false);
});

test("Initialize opens the CDC line, identifies the panel and requests a 960x480 face viewport", () => {
	const { panel, dev } = boot();

	assert.deepEqual(dev.controlTransfers.map(({ type, request, value, index, data, length }) => ({ type, request, value, index, data, length })), [
		{ type: 0x80, request: 0x06, value: 0x0200, index: 0, data: [], length: 255 },
		{ type: 0x21, request: 0x20, value: 0, index: 0, data: [0x00, 0xC2, 0x01, 0x00, 0x00, 0x00, 0x08], length: 7 },
		{ type: 0x21, request: 0x22, value: 3, index: 0, data: [], length: 0 },
	]);

	const sequence = panel.events.map((e) => (e.type === "control" ? `cmd${e.command.toString(16)}` : e.type));
	assert.deepEqual(sequence, ["resync", "zeros", "cmd6", "cmd3", "cmd11"]);
	assert.deepEqual(panel.controls(0x03)[0].payload, [100]);
	assert.deepEqual(LCD.initializeCalls, [{ width: 960, height: 480 }]);
	assert.equal(I.getState().panelInfo.model, "TXW818-ST7701S-5.5inch-hor");
	assert.equal(I.getState().panelInfo.version, 3.1);
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
});

test("a panel that does not answer the info request still works, but the user is told why it may not", () => {
	const ctx = boot({ panel: { answerInfo: false } });
	run(ctx, 200);

	assert.equal(I.getState().panelInfo, null);
	assert.ok(ctx.panel.images().length >= 1);

	const alert = ctx.dev.activeAlerts().find((a) => a.title === "Display antwortet nicht");
	assert.ok(alert, "no-reply warning");
	assert.ok(alert.description.includes("WinUSB"));
	assertCleanStream(ctx.panel);
});

test("startup diagnosis: shown as a notification and written to the log file", () => {
	const ctx = boot();
	const text = "Plugin 1.0.2 | Validate: ";
	const report = diagnosis(ctx.dev);

	assert.ok(report, "diagnosis notification");
	assert.equal(report.title, "Jungle Leopard LCD - Diagnose");
	assert.equal(report.priority, 0);
	assert.ok(report.description.startsWith(text));

	for (const part of [
		"USB: if0 cls 0x02 [0x83 int]; if1 cls 0x0a [0x02 bulk, 0x81 bulk]",
		"Endpoints: OUT 0x02 IN 0x81, control if0",
		"Line: line coding: array(0); DTR/RTS: array(0)",
		"Write: array(0)",
		"TXW818-ST7701S-5.5inch-hor, FW 3.1",
	]) {
		assert.ok(report.description.includes(part), `missing "${part}" in: ${report.description}`);
	}

	const lines = ctx.dev.logs.join("\n");
	assert.match(lines, /USB device: \{"vid":13251,"pid":30600/);
	assert.ok(lines.includes(`Diagnosis: ${report.description}`));
});

test("the startup diagnosis can be switched off", () => {
	const ctx = boot({ props: { startupReport: "false" } });

	assert.equal(diagnosis(ctx.dev), undefined);
	assert.ok(ctx.dev.logs.some((l) => l.includes("Diagnosis: Plugin")), "still logged");
});

test("endpoints are taken from the device's own USB descriptor", () => {
	LCD.reset();
	LCD.frameProvider = faceProvider();

	const clock = installClock();
	const panel = new FakePanel();
	panel.clock = clock;

	const descriptor = cdcConfigDescriptor({ commInterface: 2, dataInterface: 3, epInt: 0x84, epOut: 0x01, epIn: 0x82 });
	const dev = installDevice(panel, clock, { epOut: 0x01, epIn: 0x82, descriptor });
	setProperties(DEFAULT_PROPS);
	Plugin.Initialize();

	for (let t = 0; t < 300; t += 33) {
		Plugin.Render();
		clock.advance(33);
	}

	assert.ok(panel.images().length >= 1, "frames reach the panel on the discovered endpoint");
	assert.ok(I.getState().panelInfo, "the info reply is read from the discovered IN endpoint");
	assert.ok(dev.controlTransfers.filter((c) => c.type === 0x21).every((c) => c.index === 2), "line setup on the CDC communication interface");
	assert.ok(diagnosis(dev).description.includes("Endpoints: OUT 0x01 IN 0x82, control if2"));
	assert.deepEqual(activeTitles(dev), []);
	assertCleanStream(panel);
});

test("an unreadable descriptor falls back to the CherryUSB defaults and says so", () => {
	LCD.reset();
	LCD.frameProvider = faceProvider();

	const clock = installClock();
	const panel = new FakePanel();
	const dev = installDevice(panel, clock, { descriptor: null });
	setProperties(DEFAULT_PROPS);
	Plugin.Initialize();
	Plugin.Render();

	assert.ok(diagnosis(dev).description.includes("USB: unreadable (array(0))"));
	assert.ok(diagnosis(dev).description.includes("Endpoints: OUT 0x02 IN 0x81"));
	assert.ok(panel.images().length >= 1);
});

test("detected but blocked by the Windows serial driver: a clear alert instead of a silent blank display", () => {
	LCD.reset();
	LCD.frameProvider = faceProvider();

	const clock = installClock();
	const panel = new FakePanel();
	const dev = installDevice(panel, clock, { writeErrorCode: -12 });
	setProperties(DEFAULT_PROPS);
	Plugin.Initialize();

	for (let t = 0; t < 7000; t += 33) {
		Plugin.Render();
		clock.advance(33);
	}

	const alert = dev.activeAlerts().find((a) => a.title === "Verbindung zum Display unterbrochen");
	assert.ok(alert, `alerts: ${dev.activeAlerts().map((a) => a.title)}`);
	assert.ok(alert.description.includes("USB write error -12"));
	assert.ok(alert.description.includes("WinUSB"));
	assert.ok(dev.logs.some((l) => l.includes("Write: number -12")));
	assert.ok(diagnosis(dev).description.includes("Error: USB write error -12"));
	assert.equal(dev.logs.filter((l) => l.includes("Reconnect failed")).length, 1, "retries are not logged every time");
	assert.equal(panel.events.length, 0);

	// Once the driver is fixed, the plugin recovers by itself.
	dev.writeErrorCode = 0;

	for (let t = 0; t < 3000; t += 33) {
		Plugin.Render();
		clock.advance(33);
	}

	assert.ok(!dev.activeAlerts().some((a) => a.title === "Verbindung zum Display unterbrochen"));
	assert.ok(panel.images().length >= 1);
	assertCleanStream(panel);
});

test("shutdown releases the panel; Close (0x21) only on firmware 3.1+, backlight off on request", () => {
	const ctx = boot();
	run(ctx, 100);
	Plugin.Shutdown(false);

	const tail = ctx.panel.events.slice(-2).map((e) => (e.type === "control" ? e.command : e.type));
	assert.deepEqual(tail, ["resync", 0x21]);
	assert.ok(!ctx.panel.controls(0x03).some((e) => e.payload[0] === 0));

	const dark = boot({ props: { shutdownBehavior: "Backlight Off" }, panel: { answerInfo: false } });
	run(dark, 100);
	Plugin.Shutdown(true);

	assert.deepEqual(dark.panel.controls(0x03).at(-1).payload, [0]);
	assert.equal(dark.panel.controls(0x21).length, 0, "firmware unknown: no Close");

	const before = dark.panel.events.length;
	run(dark, 500);
	assert.equal(dark.panel.events.length, before, "nothing is sent after shutdown");
});

test("USB failures raise an alert, then the plugin reconnects on its own", () => {
	const ctx = boot();
	run(ctx, 200);
	ctx.dev.failWrites = true;
	run(ctx, 500);

	assert.deepEqual(activeTitles(ctx.dev), ["Verbindung zum Display unterbrochen"]);

	ctx.dev.failWrites = false;
	const sent = ctx.panel.images().length;
	run(ctx, 2500);

	assert.deepEqual(activeTitles(ctx.dev), []);
	assert.ok(ctx.panel.images().length > sent);
	assertCleanStream(ctx.panel);
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
