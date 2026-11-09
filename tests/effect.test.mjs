// The "Zonen-Mix" lightscript (Effects/Zonen-Mix.html): its script runs in a sandbox with a fake canvas, the
// way SignalRGB runs it in a browser, with the user properties as globals.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const HTML = fs.readFileSync(new URL("../Effects/Zonen-Mix.html", import.meta.url), "utf8");
const SCRIPT = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const W = 320;
const H = 200;

function metas() {
	return [...HTML.matchAll(/<meta\s+property="([^"]+)"([^>]*)\/>/g)].map(([, property, rest]) => {
		const attrs = Object.fromEntries([...rest.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));

		return { property, ...attrs };
	});
}

/** Loads the effect with the given properties; returns helpers to render frames and read pixels. */
function load(props = {}) {
	const image = { data: new Uint8ClampedArray(W * H * 4) };
	const guides = [];
	const ctx = {
		createImageData: () => image,
		putImageData() {},
		save() {},
		restore() {},
		strokeRect: (...args) => guides.push(["rect", ...args]),
		strokeText() {},
		fillText: (text) => guides.push(["text", text]),
	};
	let frames = 0;
	const sandbox = {
		document: { getElementById: () => ({ width: W, height: H, getContext: () => ctx }) },
		window: { requestAnimationFrame: () => { frames++; } },
		...props,
	};
	vm.createContext(sandbox);
	// Wrapped in a function: top-level functions of a vm context are slow to call, unlike in a browser.
	vm.runInContext(`(function () {${SCRIPT}\n;globalThis.__api = { render, EFFECTS, LAYOUTS, DEFAULTS };})();`, sandbox);

	const api = sandbox.__api;

	return {
		api,
		guides,
		frames: () => frames,
		set: (values) => Object.assign(sandbox, values),
		render(ms) {
			guides.length = 0;
			api.render(ms);
		},
		px(x, y) {
			const o = (y * W + x) * 4;

			return [image.data[o], image.data[o + 1], image.data[o + 2]];
		},
	};
}

const statics = (colors, extra = {}) => Object.fromEntries(colors.flatMap((color, i) => [
	[`z${i + 1}Effect`, "Statisch"], [`z${i + 1}Color1`, color], [`z${i + 1}Brightness`, 100],
]).concat(Object.entries(extra)));

const near = (actual, expected, tolerance = 2) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

test("runs with SignalRGB's defaults before any property is set, and schedules the next frame", () => {
	const fx = load();
	fx.render(1000);

	assert.ok(fx.frames() >= 1);
	assert.notDeepEqual(fx.px(20, 20), [0, 0, 0], "zone 1 (Regenbogen-Rad) is lit");
});

test("two zones side by side: each half shows its own color, split exactly in the middle", () => {
	const fx = load(statics(["#ff0000", "#0000ff"], { zoneLayout: "2 nebeneinander" }));
	fx.render(0);

	assert.deepEqual(fx.px(10, 100), [255, 0, 0]);
	assert.deepEqual(fx.px(159, 199), [255, 0, 0]);
	assert.deepEqual(fx.px(160, 0), [0, 0, 255]);
	assert.deepEqual(fx.px(310, 100), [0, 0, 255]);
});

test("every layout maps its zones to the right areas", () => {
	const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
	const rgb = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
	const cases = {
		"1 Zone": [[160, 100, 0], [5, 5, 0], [315, 195, 0]],
		"3 nebeneinander": [[50, 100, 0], [160, 100, 1], [270, 100, 2]],
		"4 nebeneinander": [[40, 100, 0], [120, 100, 1], [200, 100, 2], [280, 100, 3]],
		"2 untereinander": [[160, 50, 0], [160, 150, 1]],
		"3 untereinander": [[160, 30, 0], [160, 100, 1], [160, 170, 2]],
		"2 x 2 Raster": [[80, 50, 0], [240, 50, 1], [80, 150, 2], [240, 150, 3]],
	};

	for (const [layout, points] of Object.entries(cases)) {
		const fx = load(statics(colors, { zoneLayout: layout }));
		fx.render(0);

		for (const [x, y, zone] of points) {
			assert.deepEqual(fx.px(x, y), rgb[zone], `${layout} at ${x},${y}`);
		}
	}
});

test("an unknown layout falls back to two zones instead of failing", () => {
	const fx = load(statics(["#ff0000", "#0000ff"], { zoneLayout: "Unsinn" }));
	fx.render(0);

	assert.deepEqual(fx.px(10, 10), [255, 0, 0]);
	assert.deepEqual(fx.px(310, 10), [0, 0, 255]);
});

test("brightness is per zone", () => {
	const fx = load(statics(["#ff0000", "#ff0000"], { z2Brightness: 50 }));
	fx.render(0);

	assert.deepEqual(fx.px(10, 10), [255, 0, 0]);
	assert.ok(near(fx.px(310, 10), [127.5, 0, 0], 1), String(fx.px(310, 10)));
});

test("Aus switches a zone off, the other keeps running", () => {
	const fx = load({ zoneLayout: "2 nebeneinander", z1Effect: "Aus", z2Effect: "Regenbogen-Welle", z2Speed: 5 });
	fx.render(1234);

	assert.deepEqual(fx.px(80, 100), [0, 0, 0]);
	assert.notDeepEqual(fx.px(240, 100), [0, 0, 0]);
});

test("Atmen fades between color 2 and color 1 over time; Tempo 0 holds color 1", () => {
	const fx = load({ zoneLayout: "1 Zone", z1Effect: "Atmen", z1Color1: "#00ff00", z1Color2: "#000000", z1Speed: 5, z1Brightness: 100 });
	const greens = [];

	for (let ms = 0; ms < 4000; ms += 100) {
		fx.render(ms);
		greens.push(fx.px(160, 100)[1]);
	}

	assert.ok(Math.min(...greens) < 20 && Math.max(...greens) > 235, `${Math.min(...greens)}..${Math.max(...greens)}`);

	fx.set({ z1Speed: 0 });
	fx.render(777);
	assert.deepEqual(fx.px(160, 100), [0, 255, 0]);
});

test("Farbwechsel colors the whole zone the same and changes over time", () => {
	const fx = load({ zoneLayout: "1 Zone", z1Effect: "Farbwechsel", z1Speed: 5 });
	fx.render(0);
	const first = fx.px(10, 10);

	assert.deepEqual(fx.px(300, 190), first);

	fx.render(1000);
	assert.notDeepEqual(fx.px(10, 10), first);
});

test("Regenbogen-Welle moves, and a negative Tempo moves it the other way", () => {
	const hueAt = (fx, x) => {
		const [r, g, b] = fx.px(x, 100);

		return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
	};
	const shift = (speed) => {
		const fx = load({ zoneLayout: "1 Zone", z1Effect: "Regenbogen-Welle", z1Speed: speed });
		fx.render(0);
		const before = hueAt(fx, 100);
		fx.render(100);

		return Math.atan2(Math.sin(hueAt(fx, 100) - before), Math.cos(hueAt(fx, 100) - before));
	};

	assert.ok(Math.abs(shift(5)) > 0.05);
	assert.equal(Math.sign(shift(5)), -Math.sign(shift(-5)));
	assert.equal(shift(0), 0);
});

test("Regenbogen-Rad shows all hues around the zone center (for fan and pump rings)", () => {
	const fx = load({ zoneLayout: "1 Zone", z1Effect: "Regenbogen-Rad", z1Speed: 0 });
	fx.render(0);

	const ring = [[260, 100], [160, 20], [60, 100], [160, 180]].map(([x, y]) => fx.px(x, y).join());
	assert.equal(new Set(ring).size, 4, "different colors around the ring");
});

test("Lauflicht: the bright head travels along the zone", () => {
	const fx = load({ zoneLayout: "1 Zone", z1Effect: "Lauflicht", z1Color1: "#ffffff", z1Color2: "#000000", z1Speed: 5 });
	const brightestX = () => {
		let best = 0;
		let bestX = 0;

		for (let x = 0; x < W; x += 2) {
			if (fx.px(x, 100)[0] > best) {
				best = fx.px(x, 100)[0];
				bestX = x;
			}
		}

		return bestX;
	};

	fx.render(0);
	const a = brightestX();
	fx.render(500);
	const b = brightestX();

	assert.notEqual(a, b);
});

test("Verlauf and Drehen blend the two chosen colors", () => {
	for (const effect of ["Verlauf", "Drehen"]) {
		const fx = load({ zoneLayout: "1 Zone", z1Effect: effect, z1Color1: "#ff0000", z1Color2: "#0000ff", z1Speed: 3 });
		fx.render(250);

		for (let x = 0; x < W; x += 16) {
			const [r, g, b] = fx.px(x, 100);
			assert.equal(g, 0, `${effect}: only red and blue`);
			assert.ok(Math.abs(r + b - 255) <= 2, `${effect}: a blend of the two colors at x=${x}`);
		}
	}
});

test("Funkeln: mostly the background color, with sparkles that come and go", () => {
	const fx = load({ zoneLayout: "1 Zone", z1Effect: "Funkeln", z1Color1: "#ffffff", z1Color2: "#000000", z1Speed: 5 });
	const lit = () => {
		let count = 0;

		for (let y = 4; y < H; y += 8) {
			for (let x = 4; x < W; x += 8) {
				count += fx.px(x, y)[0] > 40 ? 1 : 0;
			}
		}

		return count;
	};

	fx.render(0);
	const first = lit();
	assert.ok(first > 0 && first < 0.5 * (W / 8) * (H / 8), `${first} sparkles`);

	const snapshot = fx.px(4, 4).join() + fx.px(100, 100).join();
	let changed = false;

	for (let ms = 100; ms < 3000 && !changed; ms += 100) {
		fx.render(ms);
		changed = fx.px(4, 4).join() + fx.px(100, 100).join() !== snapshot || lit() !== first;
	}

	assert.ok(changed);
});

test("Zonen anzeigen draws a frame and the number of every zone, only while switched on", () => {
	for (const value of [true, 1, "1", "true"]) {
		const fx = load({ zoneLayout: "2 x 2 Raster", showZones: value });
		fx.render(0);

		assert.equal(fx.guides.filter((g) => g[0] === "rect").length, 4);
		assert.deepEqual(fx.guides.filter((g) => g[0] === "text").map((g) => g[1]), ["1", "2", "3", "4"]);
	}

	for (const value of [false, 0, "0", "false", undefined]) {
		const fx = load({ zoneLayout: "2 x 2 Raster", showZones: value });
		fx.render(0);
		assert.equal(fx.guides.length, 0, String(value));
	}
});

test("the controls SignalRGB shows match what the script does", () => {
	const fx = load();
	const props = metas();
	const byName = Object.fromEntries(props.map((p) => [p.property, p]));

	assert.equal(props.length, new Set(props.map((p) => p.property)).size, "unique property names");
	assert.deepEqual(byName.zoneLayout.values.split(","), Object.keys(fx.api.LAYOUTS));
	assert.equal(byName.zoneLayout.default, fx.api.DEFAULTS.layout);

	for (let i = 1; i <= 4; i++) {
		const [effect, color1, color2, speed, brightness] = fx.api.DEFAULTS.zones[i - 1];

		assert.deepEqual(byName[`z${i}Effect`].values.split(","), [...fx.api.EFFECTS], `zone ${i} effect list`);
		assert.equal(byName[`z${i}Effect`].default, effect);
		assert.equal(byName[`z${i}Color1`].default, color1);
		assert.equal(byName[`z${i}Color2`].default, color2);
		assert.equal(Number(byName[`z${i}Speed`].default), speed);
		assert.equal(Number(byName[`z${i}Brightness`].default), brightness);
	}

	for (const p of props) {
		assert.ok(p.label, `${p.property} has a label`);

		if (p.type === "combobox") {
			assert.ok(p.values.split(",").includes(p.default), p.property);
		} else if (p.type === "number") {
			assert.ok(Number(p.min) <= Number(p.default) && Number(p.default) <= Number(p.max), p.property);
		}
	}

	// SignalRGB reads the <meta> tags itself; plain ASCII avoids any encoding trouble in its UI.
	const head = HTML.slice(0, HTML.indexOf("</head>"));
	assert.ok(/^[\x09\x0A\x0D\x20-\x7E]*$/.test(head), "ASCII-only effect metadata");
});

// Headless Chromium renders a frame in under 1 ms; this bound only catches pathological slowdowns.
test("a frame is cheap enough for SignalRGB's frame rate", () => {
	const fx = load({ zoneLayout: "2 x 2 Raster", z1Effect: "Regenbogen-Rad", z2Effect: "Drehen", z3Effect: "Funkeln", z4Effect: "Lauflicht" });
	for (let i = 0; i < 10; i++) {
		fx.render(i * 16);   // warm-up, as in a long-running effect
	}

	const start = process.hrtime.bigint();

	for (let i = 0; i < 60; i++) {
		fx.render(i * 16);
	}

	const msPerFrame = Number(process.hrtime.bigint() - start) / 1e6 / 60;
	assert.ok(msPerFrame < 25, `${msPerFrame.toFixed(2)} ms per frame`);
});
