// Runs the plugin end-to-end against the mocked SignalRGB host and writes the JPEGs
// that reached the fake panel to <outdir>/<scenario>.jpg (consumed by pillow_crosscheck.py).
//   node --import ./tests/helpers/register.mjs tests/crosscheck/capture-frames.mjs <outdir>
import fs from "node:fs";
import path from "node:path";

import LCD from "@SignalRGB/lcd";
import * as Plugin from "../../Plugins/JungleLeopard/Jungle_Leopard_LCD.js";
import { FakePanel } from "../helpers/fake-panel.mjs";
import { installClock, installDevice, setProperties } from "../helpers/device-mock.mjs";
import { makeBmp24, makeTestPattern } from "../helpers/images.mjs";

const outdir = process.argv[2];
const I = Plugin._internals;
const DEFAULTS = Object.fromEntries(Plugin.ControllableParameters().map((p) => [p.property, p.default]));
const native = Array.from(fs.readFileSync(new URL("../fixtures/pil-444-960x480.jpg", import.meta.url)));

/** Face with orientation markers: red block near its top-left corner, green near its top-right. */
function markedFace(width, height) {
	const rgb = makeTestPattern(width, height);
	const block = (x0, y0, color) => {
		for (let y = y0; y < y0 + 60; y++) {
			for (let x = x0; x < x0 + 60; x++) {
				rgb.set(color, (y * width + x) * 3);
			}
		}
	};
	block(20, 20, [255, 0, 0]);
	block(width - 80, 20, [0, 255, 0]);

	return makeBmp24(rgb, width, height);
}

const scenarios = {
	"landscape": {},
	"upside-down": { mountOrientation: "Landscape (Upside Down)" },
	"portrait-right": { mountOrientation: "Portrait (Rotated Right)" },
	"portrait-left": { mountOrientation: "Portrait (Rotated Left)" },
	"square": { faceLayout: I.LAYOUT_SQUARE, sideFillColor: "#203040" },
	"status-no-face": { messageLanguage: "English" },
};

for (const [name, props] of Object.entries(scenarios)) {
	LCD.reset();
	LCD.frameProvider = (options) => {
		if (name === "status-no-face") {
			return [];
		}

		const { width, height } = LCD.initializeCalls.at(-1);

		return options.format === "JPEG" ? native : markedFace(width, height);
	};

	const clock = installClock();
	const panel = new FakePanel();
	installDevice(panel, clock);
	setProperties({ ...DEFAULTS, ...props });
	Plugin.Initialize();

	for (let t = 0; t < 2500; t += 33) {
		Plugin.Render();
		clock.advance(33);
	}

	const images = panel.images();

	if (!images.length || panel.errors.length) {
		throw new Error(`${name}: ${images.length} images, errors ${panel.errors}`);
	}

	fs.writeFileSync(path.join(outdir, `${name}.jpg`), Buffer.from(images.at(-1).jpeg));
	console.log(`${name}: ${images.length} frames, last ${images.at(-1).jpeg.length} bytes`);
}
