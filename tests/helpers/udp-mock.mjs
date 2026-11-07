// Test double for SignalRGB's udp feature (global `udp` after device.addFeature("udp")), plus an
// independent reassembler for the bridge datagrams, written separately from the plugin and the C# bridge.

export function installUdp({ socketApi = true } = {}) {
	const sent = [];
	const bound = [];
	let listener = null;

	const socket = {
		closed: false,
		write(data, host, port) {
			sent.push({ data: Array.from(data), host, port });

			return data.length;
		},
		on(event, callback) {
			if (event === "message") {
				listener = callback;
			}
		},
		bind(port) {
			bound.push(port);
		},
		close() {
			this.closed = true;
		},
	};

	globalThis.udp = socketApi
		? { createSocket: () => socket }
		: { send: (host, port, data) => { sent.push({ data: Array.from(data), host, port }); } };

	return {
		sent,
		bound,
		socket,
		/** Simulates a datagram from the bridge arriving at the plugin's status socket. */
		deliver(text) {
			if (listener) {
				listener(text, { address: "127.0.0.1", port: 48960 });
			}
		},
		uninstall() {
			delete globalThis.udp;
		},
	};
}

/** Turns "JLB1" datagrams back into the messages the bridge would write to the serial port. */
export function reassemble(datagrams) {
	const pending = new Map();
	const messages = [];

	for (const { data } of datagrams) {
		if (String.fromCharCode(...data.slice(0, 4)) !== "JLB1" || data[4] !== 1) {
			throw new Error("not a bridge datagram");
		}

		const id = (data[5] | (data[6] << 8) | (data[7] << 16) | (data[8] << 24)) >>> 0;
		const index = data[9] | (data[10] << 8);
		const count = data[11] | (data[12] << 8);
		const entry = pending.get(id) || { chunks: new Array(count), received: 0 };
		entry.chunks[index] = data.slice(13);
		entry.received++;
		pending.set(id, entry);

		if (entry.received === count) {
			messages.push(entry.chunks.flat());
			pending.delete(id);
		}
	}

	return { messages, incomplete: pending.size };
}
