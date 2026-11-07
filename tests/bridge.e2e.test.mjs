// End-to-end: plugin -> real UDP (Node dgram standing in for SignalRGB's udp feature) -> the real bridge
// core (bridge/JungleLeopardBridge.cs compiled with Mono) -> a pseudo-terminal pair (socat) -> FakePanel.
// Skipped when mcs/mono/socat are not installed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import LCD from "@SignalRGB/lcd";
import * as Plugin from "../Jungle_Leopard_LCD.js";
import { FakePanel } from "./helpers/fake-panel.mjs";
import { cdcConfigDescriptor, installClock, installDevice, setProperties } from "./helpers/device-mock.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const NATIVE = Array.from(fs.readFileSync(new URL("./fixtures/pil-420-960x480.jpg", import.meta.url)));
const DEFAULT_PROPS = Object.fromEntries(Plugin.ControllableParameters().map((p) => [p.property, p.default]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function available(command) {
	try {
		execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });

		return true;
	} catch (e) {
		return false;
	}
}

const missing = ["mcs", "mono", "socat"].filter((c) => !available(c));

/** SignalRGB's udp feature, backed by real Node UDP sockets. */
function realUdp() {
	const sender = dgram.createSocket("udp4");
	const listener = dgram.createSocket("udp4");

	return {
		createSocket: () => ({
			write(data, host, port) {
				sender.send(Buffer.from(data), port, host);

				return data.length;
			},
			on(event, callback) {
				if (event === "message") {
					listener.on("message", (message) => callback(message.toString("latin1")));
				}
			},
			bind(port) {
				listener.bind(port, "127.0.0.1");
			},
			close() {
				sender.close();
				listener.close();
			},
		}),
	};
}

async function waitFor(predicate, ms, what) {
	const end = Date.now() + ms;

	while (Date.now() < end) {
		if (predicate()) {
			return;
		}

		await sleep(20);
	}

	throw new Error(`timed out waiting for ${what}`);
}

test("plugin -> UDP -> bridge (C#) -> serial -> panel: the panel receives a valid stream", { skip: missing.length ? `needs ${missing.join(", ")}` : false, timeout: 60000 }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jl-bridge-"));
	const exe = path.join(dir, "host.exe");
	const panelPath = path.join(dir, "panel");
	const hostPath = path.join(dir, "host");
	const children = [];

	execFileSync("mcs", ["-langversion:5", "-r:System.dll", `-out:${exe}`,
		path.join(ROOT, "bridge/JungleLeopardBridge.cs"), path.join(ROOT, "tests/bridge-e2e/TestHost.cs")]);

	try {
		const socat = spawn("socat", [`pty,rawer,echo=0,link=${panelPath}`, `pty,rawer,echo=0,link=${hostPath}`], { stdio: "ignore" });
		children.push(socat);
		await waitFor(() => fs.existsSync(panelPath) && fs.existsSync(hostPath), 5000, "socat ptys");

		const panel = new FakePanel();
		const reader = fs.createReadStream(panelPath);
		reader.on("data", (chunk) => panel.receive(chunk));
		reader.on("error", () => {});

		const host = spawn("mono", [exe, hostPath, "48960", "48961", path.join(dir, "bridge.log")], { stdio: ["pipe", "pipe", "inherit"] });
		children.push(host);

		let hostOutput = "";
		host.stdout.on("data", (d) => { hostOutput += d; });
		await waitFor(() => hostOutput.includes("READY"), 10000, "bridge start");

		// The reported hardware: SignalRGB's bulk_transfer fails, so the plugin must use the bridge.
		LCD.reset();
		LCD.frameProvider = (options) => (options.format === "JPEG" ? NATIVE : []);
		globalThis.udp = realUdp();

		const clock = installClock();
		const dev = installDevice(new FakePanel(), clock, {
			epOut: 0x01, epIn: 0x82, bulkBroken: true, descriptor: cdcConfigDescriptor({ epInt: 0x81, epOut: 0x01, epIn: 0x82 }),
		});
		setProperties(DEFAULT_PROPS);
		Plugin.Initialize();

		for (let i = 0; i < 120; i++) {
			Plugin.Render();
			clock.advance(33);
			await sleep(10);
		}

		await waitFor(() => panel.images().length >= 3, 10000, "frames on the serial side");

		const bridge = Plugin._internals.getBridge();
		await waitFor(() => bridge.status.includes("state=connected"), 5000, "bridge status");

		assert.deepEqual(panel.errors, [], "every byte arrived intact");
		assert.deepEqual(panel.events.slice(0, 4).map((e) => (e.type === "control" ? e.command : e.type)), ["resync", "zeros", 0x03, 0x11]);
		assert.ok(panel.images().every((image) => image.ready));
		assert.deepEqual(panel.images()[0].jpeg, NATIVE);
		assert.ok(panel.controls(0x11).length >= 2, "keep-alive passes through");
		assert.match(bridge.status, /state=connected port=\S+ msgs=\d+ dropped=0 version=1\.0\.0/);

		// With a status coming in, no "bridge not reachable" alert is shown.
		Plugin.Render();
		assert.ok(!dev.activeAlerts().some((a) => a.title === "Bridge nicht erreichbar"));

		Plugin.Shutdown(false);
		host.stdin.end();
		reader.destroy();
	} finally {
		delete globalThis.udp;

		for (const child of children) {
			child.kill();
		}

		fs.rmSync(dir, { recursive: true, force: true });
	}
});
