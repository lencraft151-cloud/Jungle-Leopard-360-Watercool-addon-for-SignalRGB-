import test from "node:test";
import assert from "node:assert/strict";

import { _internals as I } from "../Jungle_Leopard_LCD.js";
import { makeBmp24, makeBmp32, makeTestPattern } from "./helpers/images.mjs";

test("24-bit bottom-up BMP with row padding decodes exactly", () => {
	const rgb = makeTestPattern(13, 7);
	const image = I.decodeBmp(makeBmp24(rgb, 13, 7));

	assert.deepEqual([image.width, image.height], [13, 7]);
	assert.deepEqual(Array.from(image.rgb), Array.from(rgb));
});

test("32-bit top-down BITFIELDS BMP decodes exactly when opaque", () => {
	const rgb = makeTestPattern(9, 5);
	const image = I.decodeBmp(makeBmp32(rgb, 9, 5, { topDown: true }));

	assert.deepEqual(Array.from(image.rgb), Array.from(rgb));
});

test("transparent pixels are composited over black", () => {
	const rgb = new Uint8Array([200, 100, 50, 200, 100, 50]);
	const image = I.decodeBmp(makeBmp32(rgb, 2, 1, { alpha: [255, 0] }));

	assert.deepEqual(Array.from(image.rgb), [200, 100, 50, 0, 0, 0]);
});

test("unsupported or broken BMPs throw coded errors", () => {
	const bmp = makeBmp24(makeTestPattern(4, 4), 4, 4);
	const eightBit = bmp.slice();
	eightBit[28] = 8;

	assert.throws(() => I.decodeBmp([1, 2, 3]), { code: "bmp-signature" });
	assert.throws(() => I.decodeBmp(eightBit), { code: "bmp-format" });
	assert.throws(() => I.decodeBmp(bmp.slice(0, 60)), { code: "bmp-truncated" });
});

test("viewport size follows layout and orientation", () => {
	const v = (layout, rotation) => I.viewportFor({ layout, rotation });

	assert.deepEqual(v(I.LAYOUT_FULL, 0), [960, 480]);
	assert.deepEqual(v(I.LAYOUT_FULL, 180), [960, 480]);
	assert.deepEqual(v(I.LAYOUT_FULL, 90), [480, 960]);
	assert.deepEqual(v(I.LAYOUT_FULL, 270), [480, 960]);
	assert.deepEqual(v(I.LAYOUT_SQUARE, 0), [480, 480]);
	assert.deepEqual(v(I.LAYOUT_SQUARE, 90), [480, 480]);
});

test("a square face is centered with fill on both sides", () => {
	const map = I.buildPixelMap(480, 480, 0);
	const row = 100 * 960;

	assert.equal(map[row + 239], -1);
	assert.equal(map[row + 240], 100 * 480);
	assert.equal(map[row + 719], 100 * 480 + 479);
	assert.equal(map[row + 720], -1);
});

/** Rotates a w x h index grid the way a viewer sees a physically rotated panel. */
function viewerSees(panel, w, h, degrees) {
	const out = [];

	if (degrees === 180) {
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				out.push(panel[(h - 1 - y) * w + (w - 1 - x)]);
			}
		}

		return out;
	}

	// Clockwise turn: the viewer's grid is h wide and w tall.
	for (let y = 0; y < w; y++) {
		for (let x = 0; x < h; x++) {
			out.push(degrees === 90 ? panel[(h - 1 - x) * w + y] : panel[x * w + (w - 1 - y)]);
		}
	}

	return out;
}

test("rotated mounts: what the viewer sees on the turned panel is the upright face", () => {
	const pw = 8;
	const ph = 4;

	for (const degrees of [90, 180, 270]) {
		const [sw, sh] = degrees === 180 ? [pw, ph] : [ph, pw];
		const map = I.buildPixelMap(sw, sh, degrees, pw, ph);
		const seen = viewerSees(Array.from(map), pw, ph, degrees);
		const upright = Array.from({ length: sw * sh }, (_, i) => i);

		assert.deepEqual(seen, upright, `${degrees} degrees`);
	}
});

test("frames of an unexpected size are fitted and centered instead of cropped", () => {
	const map = I.buildPixelMap(4, 4, 0, 8, 4);

	assert.deepEqual(Array.from(map.slice(0, 8)), [-1, -1, 0, 1, 2, 3, -1, -1]);
});

test("composition copies source pixels and paints the fill color", () => {
	const image = { width: 2, height: 2, rgb: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) };
	const map = I.buildPixelMap(2, 2, 0, 4, 2);
	const out = I.composeFrame(image, map, [9, 9, 9], new Uint8Array(4 * 2 * 3));

	assert.deepEqual(Array.from(out.slice(0, 12)), [9, 9, 9, 1, 2, 3, 4, 5, 6, 9, 9, 9]);
	assert.deepEqual(Array.from(out.slice(12)), [9, 9, 9, 7, 8, 9, 10, 11, 12, 9, 9, 9]);
});
