// Test double for SignalRGB's global `device` object (see types/device.d.ts in signal-plugins),
// wired to a FakePanel and a controllable clock.

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

export function installDevice(panel, clock, { failWrites = false, writeErrorCode = 0 } = {}) {
	let alertCounter = 0;
	const dev = {
		failWrites,
		// Non-zero: writes return this libusb error code instead of throwing (e.g. -12 when the
		// Windows serial driver still owns the device), and nothing reaches the panel.
		writeErrorCode,
		logs: [],
		alerts: [],
		controlTransfers: [],
		bulkCalls: [],

		getDeviceInfo() {
			return { vid: 0x33C3, pid: 0x7788, manufacturer: "CherryUSB", product: "CherryUSB CDC DEMO", serial: "2022123456", type: "rawusb" };
		},

		bulk_transfer(endpoint, data, length) {
			this.bulkCalls.push({ endpoint, length });

			if (endpoint === 0x02) {
				if (this.failWrites) {
					throw new Error("LIBUSB_ERROR_NO_DEVICE");
				}

				if (this.writeErrorCode) {
					return this.writeErrorCode;
				}

				if (data.length !== length) {
					throw new Error(`length ${length} does not match data length ${data.length}`);
				}

				panel.receive(data);

				return [];
			}

			if (endpoint === 0x81) {
				return panel.read(length);
			}

			throw new Error(`unexpected endpoint ${endpoint}`);
		},

		control_transfer(type, request, value, index, data, length, timeout) {
			this.controlTransfers.push({ type, request, value, index, data: [...data], length, timeout });

			return [];
		},

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
