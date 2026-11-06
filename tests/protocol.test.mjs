import test from "node:test";
import assert from "node:assert/strict";

import { _internals as I } from "../Plugins/JungleLeopard/Jungle_Leopard_LCD.js";
import { FakePanel, controlFrame } from "./helpers/fake-panel.mjs";

test("live keep-alive frame matches the bytes the vendor app sends", () => {
	assert.deepEqual(I.buildControlFrame(0x11), [0x55, 0xAA, 0x07, 0x00, 0x11, 0x17, 0x01]);
});

test("close frame matches the reference implementation", () => {
	assert.deepEqual(I.buildControlFrame(0x21), [0x55, 0xAA, 0x07, 0x00, 0x21, 0x27, 0x01]);
});

test("backlight frame carries one payload byte and a 16-bit sum over the whole frame", () => {
	const frame = I.buildControlFrame(0x03, [50]);
	const sum = 0x55 + 0xAA + 0x08 + 0x00 + 0x03 + 50;

	assert.deepEqual(frame, [0x55, 0xAA, 0x08, 0x00, 0x03, 50, sum & 0xFF, sum >> 8]);
});

test("image envelope is u32 LE length, the JPEG, and a sum16 that also covers the length", () => {
	const jpeg = [0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9];
	const envelope = Array.from(I.buildImageEnvelope(jpeg));
	const sum = 6 + jpeg.reduce((a, b) => a + b, 0);

	assert.deepEqual(envelope.slice(0, 4), [6, 0, 0, 0]);
	assert.deepEqual(envelope.slice(4, 10), jpeg);
	assert.deepEqual(envelope.slice(10), [sum & 0xFF, (sum >> 8) & 0xFF]);
});

test("frames whose length would start with 55 AA get a JPEG comment so the panel cannot misread them", () => {
	const jpeg = new Uint8Array(0xAA55);
	jpeg.set([0xFF, 0xD8, 0xFF, 0xDB]);
	jpeg[jpeg.length - 2] = 0xFF;
	jpeg[jpeg.length - 1] = 0xD9;

	const fixed = I.avoidMagicCollision(jpeg);

	assert.equal(fixed.length, 0xAA55 + 5);
	assert.deepEqual(Array.from(fixed.slice(0, 7)), [0xFF, 0xD8, 0xFF, 0xFE, 0x00, 0x03, 0x00]);
	assert.deepEqual(Array.from(fixed.slice(7, 9)), [0xFF, 0xDB]);
	assert.notEqual(I.buildImageEnvelope(fixed)[0] === 0x55 && I.buildImageEnvelope(fixed)[1] === 0xAA, true);

	const untouched = new Uint8Array(1000);
	assert.equal(I.avoidMagicCollision(untouched), untouched);
});

test("the fake panel accepts the plugin's frames with valid checksums", () => {
	const panel = new FakePanel();
	panel.receive(I.buildControlFrame(0x03, [80]));
	panel.receive(Array.from(I.buildImageEnvelope([0xFF, 0xD8, 0xFF, 0xD9])));

	assert.deepEqual(panel.errors, []);
	assert.equal(panel.controls(0x03)[0].payload[0], 80);
	assert.equal(panel.images().length, 1);
});

test("extractReply finds a framed reply between stray bytes and checks its sum", () => {
	const body = [...Buffer.from("{\"model\":\"TXW818-ST7701S-5.5inch-hor\"}")];
	const buffer = [0x00, 0x13, ...controlFrame(0x06, body), 0x00];
	const reply = I.extractReply(buffer);

	assert.equal(reply.command, 0x06);
	assert.equal(reply.text, "{\"model\":\"TXW818-ST7701S-5.5inch-hor\"}");
	assert.equal(reply.checksumOk, true);
	assert.equal(I.extractReply(buffer.slice(0, 10)), null);
});

test("device info: vendor model string identifies the 960x480 panel", () => {
	const info = I.parseDeviceInfo("{\"model\":\"TXW818-ST7701S-5.5inch-hor\",\"version\":\"3.1\"}");

	assert.equal(info.model, "TXW818-ST7701S-5.5inch-hor");
	assert.equal(info.version, 3.1);
	assert.deepEqual(I.assessPanel(info), { status: "ok", reason: "model" });
});

test("device info: explicit resolution fields win, nested and in either orientation", () => {
	const ok = I.parseDeviceInfo("{\"name\":\"panel\",\"lcd\":{\"width\":480,\"height\":960},\"fw\":\"v2.8\"}");
	assert.equal(ok.version, 2.8);
	assert.equal(I.assessPanel(ok).status, "ok");

	const other = I.parseDeviceInfo("{\"screen\":{\"w\":462,\"h\":1920}}");
	assert.deepEqual(I.assessPanel(other), { status: "mismatch", reason: "462x1920" });
});

test("device info: non-JSON replies and missing replies degrade to 'unknown' instead of blocking", () => {
	const raw = I.parseDeviceInfo("noise TXW818-ST7701S-5.5inch-hor 960x480 more");
	assert.equal(raw.model, "TXW818-ST7701S-5.5inch-hor");
	assert.equal(raw.width, 960);
	assert.equal(I.assessPanel(raw).status, "ok");

	assert.deepEqual(I.assessPanel(I.parseDeviceInfo("")), { status: "unknown", reason: "no-model" });
	assert.deepEqual(I.assessPanel(I.parseDeviceInfo("{\"model\":\"ABC-4inch\"}")), { status: "unknown", reason: "unknown-model" });
	assert.deepEqual(I.assessPanel(null), { status: "unknown", reason: "no-reply" });
});
