// Test double for SignalRGB's built-in "@SignalRGB/serial" module (see @SignalRGB/Serial/serial.d.ts in
// signal-plugins). Like the real module it is one object per plugin, bound to the device's COM port;
// installSerial() wires it to a FakePanel and a controllable clock.
const METHODS = ["connect", "disconnect", "isConnected", "write", "read", "readAll", "getPortName", "getDeviceInfo"];

const serial = {};

/** Default for the writeResult option: write() returns the number of bytes it took, as documented. */
export const BYTE_COUNT = Symbol("byte count");

/**
 * Options (all can be changed later on the returned port object):
 *   busy        another program holds the port: connect() does not open it
 *   connectThrows  connect() throws
 *   failWrites  write() returns -1, nothing reaches the panel
 *   writeThrows write() throws
 *   shortWrites write() takes only half of each call (and says so)
 *   writeResult value write() returns instead of the byte count (e.g. undefined, 0 or true)
 *   missing     method names this SignalRGB build does not have
 *   portName    COM port name reported by getPortName()
 */
export function installSerial(panel, clock, {
	busy = false, connectThrows = false, failWrites = false, writeThrows = false, shortWrites = false,
	writeResult = BYTE_COUNT, missing = [], portName = "COM5",
} = {}) {
	const port = {
		busy, connectThrows, failWrites, writeThrows, shortWrites, writeResult, portName,
		connected: false,
		connectCalls: [],
		disconnects: 0,
		writeCalls: 0,
		readCalls: [],

		unplug() {
			this.connected = false;
			this.busy = true;
		},
	};

	const impl = {
		connect(options) {
			port.connectCalls.push(options);

			if (port.connectThrows) {
				throw new Error("Access is denied.");
			}

			port.connected = !port.busy;
		},

		disconnect() {
			port.disconnects++;
			port.connected = false;
		},

		isConnected() {
			return port.connected;
		},

		write(data) {
			port.writeCalls++;

			if (port.writeThrows) {
				throw new Error("The device does not recognize the command.");
			}

			if (!port.connected || port.failWrites) {
				return -1;
			}

			if (!Array.isArray(data)) {
				throw new Error(`write() expects a number array, got ${Object.prototype.toString.call(data)}`);
			}

			const taken = port.shortWrites && data.length > 1 ? Math.floor(data.length / 2) : data.length;
			panel.receive(data.slice(0, taken));

			return port.writeResult === BYTE_COUNT ? taken : port.writeResult;
		},

		read(maxBytes, timeout) {
			port.readCalls.push({ maxBytes, timeout });
			const data = panel.read(maxBytes || 4096);

			if (data.length === 0) {
				clock.advance(timeout === undefined ? 1000 : timeout);

				return undefined;
			}

			return data;
		},

		readAll() {
			const data = panel.read(1 << 20);

			return data.length ? data : undefined;
		},

		getPortName() {
			return port.portName;
		},

		getDeviceInfo() {
			return {
				vid: 0x33C3, pid: 0x7788, manufacturer: "Microsoft", product: "USB Serial Device", serial: "2022123456",
				path: `\\\\.\\${port.portName}`, type: "serial", class: "Ports", driverDesc: "USB Serial Device",
				uid: "", deviceId: "USB\\VID_33C3&PID_7788\\2022123456", port: 3, hub: 1, interface: 0,
			};
		},
	};

	for (const name of METHODS) {
		delete serial[name];

		if (!missing.includes(name)) {
			serial[name] = impl[name];
		}
	}

	return port;
}

export default serial;
