// Synthetic test images and BMP writers (to emulate LCD.getFrame({format: "BMP"})).

/** A face-like test pattern: gradient background, a ring, bars and fine detail. */
export function makeTestPattern(width, height, seed = 1) {
	const rgb = new Uint8Array(width * height * 3);
	const cx = width * 0.3;
	const cy = height * 0.5;
	const r = Math.min(width, height) * 0.3;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 3;
			let red = 30 + (150 * (1 - x / width) * (1 - y / height));
			let green = 40 + (90 * (x / width));
			let blue = 90 + (140 * (x / width));
			const d = Math.hypot(x - cx, y - cy);

			if (Math.abs(d - r) < Math.max(2, r * 0.08)) {
				red = green = blue = 240;
			}

			if (x > width * 0.55 && (Math.floor(x / Math.max(4, width / 40)) + seed) % 3 === 0 &&
				y > height * (0.3 + 0.4 * ((Math.floor(x / 10) * 7) % 5) / 5)) {
				red = 250;
				green = 250;
				blue = 255;
			}

			rgb[o] = red;
			rgb[o + 1] = green;
			rgb[o + 2] = blue;
		}
	}

	return rgb;
}

export function solidImage(width, height, color) {
	const rgb = new Uint8Array(width * height * 3);

	for (let i = 0; i < width * height; i++) {
		rgb.set(color, i * 3);
	}

	return rgb;
}

function header(bytes, fileSize, dataOffset) {
	bytes[0] = 0x42;
	bytes[1] = 0x4D;
	new DataView(bytes.buffer).setUint32(2, fileSize, true);
	new DataView(bytes.buffer).setUint32(10, dataOffset, true);
}

/** 24-bit BI_RGB, bottom-up rows, 4-byte row padding (what most encoders write). */
export function makeBmp24(rgb, width, height) {
	const stride = Math.ceil(width * 3 / 4) * 4;
	const dataOffset = 54;
	const bytes = new Uint8Array(dataOffset + stride * height);
	const view = new DataView(bytes.buffer);
	header(bytes, bytes.length, dataOffset);
	view.setUint32(14, 40, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, 24, true);

	for (let y = 0; y < height; y++) {
		const row = dataOffset + (height - 1 - y) * stride;

		for (let x = 0; x < width; x++) {
			const s = (y * width + x) * 3;
			bytes[row + x * 3] = rgb[s + 2];
			bytes[row + x * 3 + 1] = rgb[s + 1];
			bytes[row + x * 3 + 2] = rgb[s];
		}
	}

	return Array.from(bytes);
}

/** 32-bit BI_BITFIELDS with a BITMAPV4HEADER, optionally top-down and with an alpha channel. */
export function makeBmp32(rgb, width, height, { topDown = false, alpha = null } = {}) {
	const dataOffset = 14 + 108;
	const bytes = new Uint8Array(dataOffset + width * height * 4);
	const view = new DataView(bytes.buffer);
	header(bytes, bytes.length, dataOffset);
	view.setUint32(14, 108, true);
	view.setInt32(18, width, true);
	view.setInt32(22, topDown ? -height : height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, 32, true);
	view.setUint32(30, 3, true);
	view.setUint32(54, 0x00FF0000, true);
	view.setUint32(58, 0x0000FF00, true);
	view.setUint32(62, 0x000000FF, true);
	view.setUint32(66, 0xFF000000, true);

	for (let y = 0; y < height; y++) {
		const row = dataOffset + (topDown ? y : height - 1 - y) * width * 4;

		for (let x = 0; x < width; x++) {
			const s = (y * width + x) * 3;
			bytes[row + x * 4] = rgb[s + 2];
			bytes[row + x * 4 + 1] = rgb[s + 1];
			bytes[row + x * 4 + 2] = rgb[s];
			bytes[row + x * 4 + 3] = alpha ? alpha[y * width + x] : 255;
		}
	}

	return Array.from(bytes);
}
