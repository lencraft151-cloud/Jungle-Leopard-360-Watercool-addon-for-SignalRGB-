// Bridge transport: what happens on the reported hardware, where SignalRGB cannot write to the panel's
// bulk endpoint and the plugin hands the byte stream to the local bridge over UDP.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import LCD from "@SignalRGB/lcd";
import * as Plugin from "../Jungle_Leopard_LCD.js";
import { FakePanel } from "./helpers/fake-panel.mjs";
import { cdcConfigDescriptor, installClock, installDevice, setProperties } from "./helpers/device-mock.mjs";
import { installUdp, reassemble } from "./helpers/udp-mock.mjs";

const I = Plugin._internals;
const NATIVE = Array.from(fs.readFileSync(new URL("./fixtures/pil-420-960x480.jpg", import.meta.url)));
const DEFAULT_PROPS = Object.fromEntries(Plugin.ControllableParameters().map((p) => [p.property, p.default]));
const DIAGNOSIS = "Jungle Leopard LCD - Diagnose";

/** The reported machine: descriptor with OUT 0x01 / IN 0x82, and every bulk_transfer returns array(-1). */
function bootBroken({ udp = {}, props = {}, ms = 300 } = {}) {
	LCD.reset();
	LCD.frameProvider = (options) => (options.format === "JPEG" ? NATIVE : []);

	const clock = installClock();
	const udpMock = udp === null ? null : installUdp(udp);
	const dev = installDevice(new FakePanel(), clock, {
		epOut: 0x01, epIn: 0x82, bulkBroken: true, descriptor: cdcConfigDescriptor({ epInt: 0x81, epOut: 0x01, epIn: 0x82 }),
	});
	setProperties({ ...DEFAULT_PROPS, ...props });
	Plugin.Initialize();

	const ctx = { clock, dev, udp: udpMock };
	run(ctx, ms);

	return ctx;
}

function run(ctx, ms, step = 33) {
	for (let t = 0; t < ms; t += step) {
		Plugin.Render();
		ctx.clock.advance(step);
	}
}

function problems(dev) {
	return dev.activeAlerts().filter((a) => a.title !== DIAGNOSIS).map((a) => a.title);
}

function streamToPanel(sent) {
	const { messages, incomplete } = reassemble(sent);
	const panel = new FakePanel();

	for (const message of messages) {
		panel.receive(message);
	}

	return { panel, incomplete };
}

test.afterEach(() => {
	delete globalThis.udp;
});

test("reported hardware: frames go to the bridge over UDP and form a valid panel stream", () => {
	const ctx = bootBroken();
	const { panel, incomplete } = streamToPanel(ctx.udp.sent);

	assert.equal(incomplete, 0);
	assert.ok(ctx.udp.sent.every((d) => d.host === "127.0.0.1" && d.port === 48960));
	assert.ok(ctx.udp.sent.every((d) => d.data.length <= 13 + 8192), "datagrams stay small");
	assert.deepEqual(panel.events.slice(0, 4).map((e) => (e.type === "control" ? e.command : e.type)), ["resync", "zeros", 0x03, 0x11]);
	assert.ok(panel.images().length >= 1);
	assert.deepEqual(panel.images()[0].jpeg, NATIVE, "the face frame arrives byte-for-byte");
	assert.deepEqual(panel.errors, []);
	assert.deepEqual(ctx.udp.bound, [48961], "listens for bridge status");
	assert.equal(I.getState().bridgeMode, true);
});

test("bridge status: silent bridge raises an alert, a connected bridge clears it", () => {
	const ctx = bootBroken({ ms: 5000 });

	assert.deepEqual(problems(ctx.dev), ["Bridge nicht erreichbar"]);

	ctx.udp.deliver("JLB1 STATUS state=connected port=COM5 msgs=42 dropped=0 version=1.0.0");
	run(ctx, 100);

	assert.deepEqual(problems(ctx.dev), []);

	const report = ctx.dev.activeAlerts().find((a) => a.title === DIAGNOSIS).description;
	assert.ok(report.includes("Transport: bridge"), report);
	assert.ok(report.includes("Bridge: socket, listen yes"), report);
});

test("bridge status: the diagnosis is refreshed with the bridge's answer", () => {
	const ctx = bootBroken({ ms: 100 });
	ctx.udp.deliver([..."JLB1 STATUS state=connected port=COM5 msgs=3 dropped=0 version=1.0.0"].map((c) => c.charCodeAt(0)));
	run(ctx, 100);

	const report = ctx.dev.activeAlerts().find((a) => a.title === DIAGNOSIS).description;
	assert.ok(report.includes("bridge connected COM5 (msgs 3, v1.0.0)"), report);
});

test("bridge status: no COM port and port errors get their own explanations", () => {
	const ctx = bootBroken({ ms: 100 });

	ctx.udp.deliver("JLB1 STATUS state=noport port=- msgs=0 dropped=0 version=1.0.0");
	run(ctx, 100);
	assert.deepEqual(problems(ctx.dev), ["Display-COM-Port nicht gefunden"]);

	ctx.udp.deliver("JLB1 STATUS state=error port=COM5 msgs=0 dropped=0 version=1.0.0");
	run(ctx, 100);
	assert.deepEqual(problems(ctx.dev), ["Bridge meldet einen Fehler"]);
	assert.ok(ctx.dev.activeAlerts().some((a) => a.description.includes("COM-Port COM5")));
});

test("the older udp.send() API is used when sockets are not available (status then unknown, no false alarm)", () => {
	const ctx = bootBroken({ udp: { socketApi: false }, ms: 6000 });
	const { panel } = streamToPanel(ctx.udp.sent);

	assert.ok(panel.images().length >= 1);
	assert.deepEqual(problems(ctx.dev), []);
});

test("shutdown goes through the bridge too and closes the socket", () => {
	const ctx = bootBroken({ props: { shutdownBehavior: "Backlight Off" } });
	Plugin.Shutdown(false);

	const { panel } = streamToPanel(ctx.udp.sent);
	assert.deepEqual(panel.controls(0x03).at(-1).payload, [0]);
	assert.equal(ctx.udp.socket.closed, true);
});

test("datagram format: magic, type, id, chunk index/count, payload split at 8 KB", () => {
	const bytes = Array.from({ length: 20000 }, (_, i) => i & 0xFF);
	const header = I.bridgeDatagram(0x01020304, 1, 3, bytes, 8192, 16384).slice(0, 13);

	assert.deepEqual(header, [0x4A, 0x4C, 0x42, 0x31, 0x01, 0x04, 0x03, 0x02, 0x01, 0x01, 0x00, 0x03, 0x00]);

	const udp = installUdp();
	const client = new I.BridgeClient();
	client.open(0);
	client.sendMessage(bytes);

	assert.deepEqual(udp.sent.map((d) => d.data.length - 13), [8192, 8192, 3616]);
	assert.deepEqual(reassemble(udp.sent).messages[0], bytes);
});
