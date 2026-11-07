import test from "node:test";
import assert from "node:assert/strict";

import { _internals as I } from "../Jungle_Leopard_LCD.js";
import { isPanelReady } from "./helpers/fake-panel.mjs";

test("the bitmap font covers printable ASCII plus German characters", () => {
	for (let c = 32; c < 127; c++) {
		assert.ok(I.FONT.has(String.fromCharCode(c)), `missing ${String.fromCharCode(c)}`);
	}

	for (const ch of "ÄÖÜäöüß°×…→") {
		assert.ok(I.FONT.has(ch), `missing ${ch}`);
	}

	for (const rows of I.FONT.values()) {
		assert.equal(rows.length, 8);
		assert.ok(rows.every((r) => r < 32));
	}
});

test("every message and reason text can be drawn without placeholder glyphs", () => {
	const texts = [];

	for (const message of Object.values(I.MESSAGES)) {
		for (const lang of ["de", "en"]) {
			texts.push(message[lang].title, message[lang].body);
		}
	}

	for (const reason of Object.values(I.REASONS)) {
		texts.push(reason.de, reason.en);
	}

	for (const text of texts) {
		for (const ch of text) {
			assert.ok(I.FONT.has(ch), `glyph missing for '${ch}' in: ${text}`);
		}
	}
});

test("text wrapping respects width, line count and marks truncation", () => {
	const lines = I.wrapText("alpha beta gamma delta epsilon zeta eta theta", 11, 3);

	assert.deepEqual(lines.slice(0, 2), ["alpha beta", "gamma delta"]);
	assert.equal(lines.length, 3);
	assert.ok(lines[2].endsWith("…"));
	assert.deepEqual(I.wrapText("Supercalifragilistic", 8, 5), ["Supercal", "ifragili", "stic"]);
});

test("messages are localized and carry the detail text", () => {
	const de = I.localizedMessage("FACE_INCOMPATIBLE", "de", I.describeReason("subsampling", "de"));
	const en = I.localizedMessage("FACE_INCOMPATIBLE", "en", I.describeReason("subsampling", "en"));

	assert.equal(de.title, "Face nicht kompatibel");
	assert.ok(de.body.includes("Farbunterabtastung ist nicht 4:2:0"));
	assert.equal(en.title, "Face not compatible");
	assert.ok(en.body.includes("chroma subsampling is not 4:2:0"));
	assert.equal(I.describeReason("something-new", "de"), "something-new");
});

test("status screens are full-panel images with a severity stripe that encode to panel-ready JPEGs", () => {
	const encoder = new I.JpegEncoder();

	for (const key of Object.keys(I.MESSAGES)) {
		for (const lang of ["de", "en"]) {
			const rgb = I.renderStatusScreen(key, lang, "Detail 123");

			assert.equal(rgb.length, 960 * 480 * 3);

			const jpeg = encoder.encode(rgb, 960, 480, 80);
			assert.ok(isPanelReady(Array.from(jpeg)), `${key}/${lang}`);
			assert.ok(jpeg.length <= I.TARGET_JPEG_BYTES, `${key}/${lang} is ${jpeg.length} bytes`);
		}
	}

	const error = I.renderStatusScreen("RENDER_ERROR", "de", "x");
	const info = I.renderStatusScreen("NO_FACE", "de", "");
	assert.deepEqual(Array.from(error.slice(0, 3)), [255, 77, 77]);
	assert.deepEqual(Array.from(info.slice(0, 3)), [58, 160, 255]);
});
