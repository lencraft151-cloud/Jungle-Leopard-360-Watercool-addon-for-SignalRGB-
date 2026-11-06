// A stand-in for the panel firmware: it consumes the bytes the plugin writes to
// bulk OUT 0x02 and parses them the way the device has to. Everything here is
// written independently of the plugin's own helpers on purpose.

export const MAX_FRAME = 80 * 1024;

function sum16(bytes, start, end) {
	let s = 0;

	for (let i = start; i < end; i++) {
		s += bytes[i];
	}

	return s & 0xFFFF;
}

export function controlFrame(command, payload = []) {
	const total = payload.length + 7;
	const frame = [0x55, 0xAA, total & 0xFF, total >> 8, command, ...payload];
	const s = sum16(frame, 0, frame.length);

	return [...frame, s & 0xFF, s >> 8];
}

/** Minimal, independent JPEG header reader used to judge what reached the "panel". */
export function readJpegHeader(bytes) {
	if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
		return null;
	}

	let i = 2;

	while (i + 4 <= bytes.length) {
		let marker = bytes[i + 1];

		while (marker === 0xFF) {
			i++;
			marker = bytes[i + 1];
		}

		if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
			i += 2;
			continue;
		}

		const len = (bytes[i + 2] << 8) | bytes[i + 3];

		if (marker >= 0xC0 && marker <= 0xC3) {
			const comps = [];

			for (let c = 0; c < bytes[i + 9]; c++) {
				comps.push({ h: bytes[i + 11 + c * 3] >> 4, v: bytes[i + 11 + c * 3] & 15 });
			}

			return {
				sof: marker,
				height: (bytes[i + 5] << 8) | bytes[i + 6],
				width: (bytes[i + 7] << 8) | bytes[i + 8],
				comps,
				endsWithEoi: bytes[bytes.length - 2] === 0xFF && bytes[bytes.length - 1] === 0xD9,
			};
		}

		i += 2 + len;
	}

	return null;
}

export function isPanelReady(jpeg) {
	const h = readJpegHeader(jpeg);

	return Boolean(h && h.sof === 0xC0 && h.width === 960 && h.height === 480 && h.comps.length === 3 &&
		h.comps[0].h === 2 && h.comps[0].v === 2 && h.comps[1].h === 1 && h.comps[1].v === 1 &&
		h.comps[2].h === 1 && h.comps[2].v === 1 && h.endsWithEoi && jpeg.length <= MAX_FRAME);
}

export class FakePanel {
	constructor({ infoReply = { model: "TXW818-ST7701S-5.5inch-hor", version: "3.1" }, answerInfo = true } = {}) {
		this.infoReply = infoReply;
		this.answerInfo = answerInfo;
		this.stream = [];
		this.events = [];
		this.readQueue = [];
		this.errors = [];
		this.clock = null;
	}

	record(event) {
		event.at = this.clock ? this.clock.now : 0;
		this.events.push(event);
	}

	receive(bytes) {
		for (let i = 0; i < bytes.length; i++) {
			const b = bytes[i];

			if (!Number.isInteger(b) || b < 0 || b > 255) {
				this.errors.push(`non-byte value written: ${b}`);
			}

			this.stream.push(b & 0xFF);
		}

		this.parse();
	}

	parse() {
		for (;;) {
			const s = this.stream;

			if (s.length < 4) {
				return;
			}

			if (s[0] === 0x55 && s[1] === 0xAA) {
				const total = s[2] | (s[3] << 8);

				if (s.length < total) {
					return;
				}

				const frame = s.splice(0, total);
				const ok = sum16(frame, 0, total - 2) === (frame[total - 2] | (frame[total - 1] << 8));

				if (!ok) {
					this.errors.push(`bad control checksum for command ${frame[4]}`);
				}

				const event = { type: "control", command: frame[4], payload: frame.slice(5, total - 2) };
				this.record(event);
				this.onControl(event);
				continue;
			}

			const length = (s[0] | (s[1] << 8) | (s[2] << 16) | (s[3] << 24)) >>> 0;

			if (length === 0 || length > MAX_FRAME) {
				// Flush / resync bytes (FF D9 FF D9, 00 00 00 00) or a frame the firmware would refuse.
				s.splice(0, 4);
				this.record({ type: length === 0 ? "zeros" : "resync", length });
				continue;
			}

			if (s.length < length + 6) {
				return;
			}

			const frame = s.splice(0, length + 6);
			const ok = sum16(frame, 0, length + 4) === (frame[length + 4] | (frame[length + 5] << 8));

			if (!ok) {
				this.errors.push(`bad image checksum (length ${length})`);
			}

			this.record({ type: "image", jpeg: frame.slice(4, 4 + length), ready: isPanelReady(frame.slice(4, 4 + length)) });
		}
	}

	onControl(event) {
		if (event.command === 0x06 && this.answerInfo) {
			const body = [...Buffer.from(typeof this.infoReply === "string" ? this.infoReply : JSON.stringify(this.infoReply))];
			this.readQueue.push(...controlFrame(0x06, body));
		}
	}

	read(length) {
		return this.readQueue.splice(0, length);
	}

	controls(command) {
		return this.events.filter((e) => e.type === "control" && (command === undefined || e.command === command));
	}

	images() {
		return this.events.filter((e) => e.type === "image");
	}
}
