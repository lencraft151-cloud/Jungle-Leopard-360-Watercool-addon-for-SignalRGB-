import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { _internals as I } from "../Plugins/JungleLeopard/Jungle_Leopard_LCD.js";
import { isPanelReady, readJpegHeader } from "./helpers/fake-panel.mjs";
import { makeTestPattern } from "./helpers/images.mjs";

const fixture = (name) => Array.from(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function noise(width, height, seed = 7) {
	const rgb = new Uint8Array(width * height * 3);
	let s = seed;

	for (let i = 0; i < rgb.length; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		rgb[i] = s >>> 24;
	}

	return rgb;
}

test("encoder output is a panel-ready baseline 4:2:0 JPEG", () => {
	const encoder = new I.JpegEncoder();
	const jpeg = encoder.encode(makeTestPattern(960, 480), 960, 480, 85);
	const info = I.inspectJpeg(jpeg);

	assert.equal(info.valid, true);
	assert.equal(info.baseline, true);
	assert.deepEqual([info.width, info.height], [960, 480]);
	assert.deepEqual(info.sampling, [[2, 2], [1, 1], [1, 1]]);
	assert.equal(I.panelIncompatibility(info, jpeg.length), "");
	assert.equal(isPanelReady(Array.from(jpeg)), true, "independent header check");
});

test("entropy-coded data is byte-stuffed: every FF inside the scan is followed by 00", () => {
	const encoder = new I.JpegEncoder();
	const jpeg = encoder.encode(noise(64, 48), 64, 48, 95);
	let sos = 0;

	for (let i = 2; i < jpeg.length - 1; i++) {
		if (jpeg[i] === 0xFF && jpeg[i + 1] === 0xDA) {
			sos = i + 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3]);
			break;
		}
	}

	assert.ok(sos > 0);

	for (let i = sos; i < jpeg.length - 2; i++) {
		if (jpeg[i] === 0xFF) {
			assert.equal(jpeg[i + 1], 0x00, `unstuffed FF at ${i}`);
			i++;
		}
	}

	assert.deepEqual(Array.from(jpeg.slice(-2)), [0xFF, 0xD9]);
});

test("odd sizes are padded to whole MCUs but keep their real dimensions", () => {
	const encoder = new I.JpegEncoder();

	for (const [w, h] of [[1, 1], [17, 33], [37, 23]]) {
		const header = readJpegHeader(Array.from(encoder.encode(makeTestPattern(w, h), w, h, 80)));
		assert.deepEqual([header.width, header.height], [w, h]);
	}
});

test("higher quality produces larger files", () => {
	const encoder = new I.JpegEncoder();
	const rgb = makeTestPattern(320, 160);

	assert.ok(encoder.encode(rgb, 320, 160, 40).length < encoder.encode(rgb, 320, 160, 90).length);
});

test("frames produced by libjpeg are classified like the panel would accept or reject them", () => {
	const cases = {
		"pil-420-960x480.jpg": "",
		"pil-444-960x480.jpg": "subsampling",
		"pil-420-64x32.jpg": "size",
		"pil-422-64x32.jpg": "subsampling",
		"pil-444-64x32.jpg": "subsampling",
		"pil-progressive-64x32.jpg": "progressive",
		"pil-gray-64x32.jpg": "color-format",
		"pil-restart-64x32.jpg": "restart-markers",
	};

	for (const [name, expected] of Object.entries(cases)) {
		const bytes = fixture(name);
		assert.equal(I.panelIncompatibility(I.inspectJpeg(bytes), bytes.length), expected, name);
	}
});

test("broken input is reported, not thrown", () => {
	const good = fixture("pil-420-64x32.jpg");

	assert.equal(I.inspectJpeg([]).reason, "not-jpeg");
	assert.equal(I.inspectJpeg(null).reason, "not-jpeg");
	assert.equal(I.inspectJpeg([0x89, 0x50, 0x4E, 0x47]).reason, "not-jpeg");
	assert.equal(I.inspectJpeg(good.slice(0, 40)).reason, "truncated");
	assert.equal(I.inspectJpeg([0xFF, 0xD8, 0x12, 0x34, 0x00, 0x00]).reason, "corrupt");
});

test("frames above 80 KB are flagged even when the format is right", () => {
	const encoder = new I.JpegEncoder();
	const jpeg = encoder.encode(noise(960, 480), 960, 480, 95);

	assert.ok(jpeg.length > I.MAX_JPEG_BYTES);
	assert.equal(I.panelIncompatibility(I.inspectJpeg(jpeg), jpeg.length), "too-large");
});

test("budgeted encoding stays inside the panel limit and recovers quality afterwards", () => {
	const encoder = new I.JpegEncoder();
	const busy = noise(960, 480);
	const heavy = encoder.encodeWithinBudget(busy, 960, 480, 95);

	if (heavy) {
		assert.ok(heavy.jpeg.length <= I.MAX_JPEG_BYTES);
		assert.ok(heavy.quality < 95);
	}

	const calm = makeTestPattern(960, 480);
	const qualities = [];

	for (let i = 0; i < 20; i++) {
		const result = encoder.encodeWithinBudget(calm, 960, 480, 95);
		assert.ok(result.jpeg.length <= I.TARGET_JPEG_BYTES);
		qualities.push(result.quality);
	}

	assert.ok(qualities.every((q, i) => i === 0 || q >= qualities[i - 1]), `monotonic recovery: ${qualities}`);
	assert.equal(qualities.at(-1), 95, "quality climbs back to the preferred value");
});

test("budgeted encoding gives up (null) instead of sending an oversized frame", () => {
	const encoder = new I.JpegEncoder();
	const result = encoder.encodeWithinBudget(noise(960, 480, 3), 960, 480, 95, 1000, 2000);

	assert.equal(result, null);
});
