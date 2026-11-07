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

/** A CDC-ACM configuration descriptor (communication + data interface), as a real panel reports it. */
export function cdcConfigDescriptor({ commInterface = 0, dataInterface = 1, epInt = 0x83, epOut = 0x02, epIn = 0x81 } = {}) {
	const iface = (number, cls, subclass, protocol, endpoints) => [9, 0x04, number, 0, endpoints, cls, subclass, protocol, 0];
	const ep = (address, attributes, maxPacket) => [7, 0x05, address, attributes, maxPacket & 0xFF, maxPacket >> 8, attributes === 3 ? 0x10 : 0];
	const body = [
		...iface(commInterface, 0x02, 0x02, 0x01, 1),
		5, 0x24, 0x00, 0x10, 0x01,
		5, 0x24, 0x01, 0x00, dataInterface,
		4, 0x24, 0x02, 0x02,
		5, 0x24, 0x06, commInterface, dataInterface,
		...ep(epInt, 0x03, 8),
		...iface(dataInterface, 0x0A, 0x00, 0x00, 2),
		...ep(epOut, 0x02, 512),
		...ep(epIn, 0x02, 512),
	];
	const total = 9 + body.length;

	return [9, 0x02, total & 0xFF, total >> 8, 2, 1, 0, 0x80, 50, ...body];
}

export function installDevice(panel, clock, {
	failWrites = false, writeErrorCode = 0, epOut = 0x02, epIn = 0x81, descriptor = cdcConfigDescriptor(),
	bulkBroken = false, genericBroken = false, hidEndpoints = null,
} = {}) {
	let alertCounter = 0;
	const dev = {
		failWrites,
		// Non-zero: writes return this libusb error code instead of throwing (e.g. -12 when the
		// Windows serial driver still owns the device), and nothing reaches the panel.
		writeErrorCode,
		// As observed on real hardware when the wrong interface is active: every bulk_transfer()
		// returns an array-like result with length -1.
		bulkBroken,
		genericBroken,
		hidEndpoints,
		epOut,
		epIn,
		descriptor,
		logs: [],
		alerts: [],
		controlTransfers: [],
		bulkCalls: [],
		setEndpointCalls: [],

		getDeviceInfo() {
			return { vid: 0x33C3, pid: 0x7788, manufacturer: "CherryUSB", product: "CherryUSB CDC DEMO", serial: "2022123456", type: "rawusb" };
		},

		toPanel(data, length) {
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
		},

		bulk_transfer(endpoint, data, length) {
			this.bulkCalls.push({ endpoint, length });

			if (this.bulkBroken) {
				return { length: -1 };
			}

			if (endpoint === this.epOut) {
				return this.toPanel(data, length);
			}

			if (endpoint === this.epIn) {
				return panel.read(length);
			}

			// Like libusb: an endpoint the device does not have is an error.
			throw new Error(`LIBUSB_ERROR_NOT_FOUND (endpoint 0x${endpoint.toString(16)})`);
		},

		// SignalRGB's generic write/read: for rawusb devices they use the active endpoint.
		write(data, length) {
			if (this.genericBroken) {
				throw new Error("LIBUSB_ERROR_IO");
			}

			return this.toPanel(data, length);
		},

		read(data, length) {
			if (this.genericBroken) {
				return { length: -1 };
			}

			return panel.read(length);
		},

		getHidEndpoints() {
			return this.hidEndpoints || [];
		},

		set_endpoint(iface, usage, usagePage, collection) {
			this.setEndpointCalls.push({ iface, usage, usagePage, collection });
		},

		control_transfer(type, request, value, index, data, length, timeout) {
			this.controlTransfers.push({ type, request, value, index, data: [...data], length, timeout });

			if (type === 0x80 && request === 0x06 && value === 0x0200) {
				return this.descriptor ? this.descriptor.slice(0, length) : [];
			}

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
