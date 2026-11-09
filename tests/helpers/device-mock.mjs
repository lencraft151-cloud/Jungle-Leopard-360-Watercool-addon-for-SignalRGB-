// Test double for SignalRGB's global `device` object (see types/device.d.ts in signal-plugins), plus the
// device's COM port (the "@SignalRGB/serial" mock) wired to a FakePanel and a controllable clock.
import { installSerial } from "./serial-mock.mjs";

export function installClock(start = 1_700_000_000_000) {
	const clock = {
		now: start,
		advance(ms) {
			this.now += ms;
		},
	};

	Date.now = () => clock.now;

	return clock;
}

/** Installs `device` and the serial port. `serialOptions` are those of installSerial(). */
export function installDevice(panel, clock, serialOptions = {}) {
	let alertCounter = 0;
	const dev = {
		port: installSerial(panel, clock, serialOptions),
		logs: [],
		alerts: [],

		pause(ms) {
			clock.advance(ms);
		},

		log(message) {
			this.logs.push(String(message));
		},

		notify(title, description, priority) {
			const id = `alert-${++alertCounter}`;
			this.alerts.push({ id, title, description, priority, active: true });

			return id;
		},

		denotify(id) {
			const alert = this.alerts.find((a) => a.id === id);

			if (alert) {
				alert.active = false;
			}
		},

		activeAlerts() {
			return this.alerts.filter((a) => a.active);
		},
	};

	globalThis.device = dev;

	return dev;
}

/** Sets the SignalRGB user properties the way the host does: as globals named after the property. */
export function setProperties(values) {
	for (const [key, value] of Object.entries(values)) {
		globalThis[key] = value;
	}
}
