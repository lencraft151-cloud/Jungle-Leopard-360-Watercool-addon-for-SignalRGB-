/*
 * Jungle Leopard LCD (960 x 480) for SignalRGB
 *
 * Makes the pump-head display of Jungle Leopard / TZMRIT PF360 AIO coolers a
 * native SignalRGB LCD device: it declares DeviceType "lcd" and initialises the
 * official @SignalRGB/lcd module, so SignalRGB itself renders whichever LCD face
 * the user picks from the SignalRGB library (and remembers that choice). This
 * plugin only carries the rendered frames to the panel.
 *
 * Transport: the panel enumerates as a CherryUSB CDC-ACM device (33C3:7788), i.e.
 * a COM port ("USB Serial Device"). The plugin uses SignalRGB's official serial
 * module (@SignalRGB/serial, Type "serial"), exactly like SignalRGB's own Turzx
 * LCD and HYTE CNVS plugins. No extra driver and no helper program are needed.
 *
 * Panel protocol (recovered from the vendor app by the open-source projects
 * senesees/Jungle-Leopard-Display-TZMRIT-PF360-LCD and yughias/JL-LCD-AIO):
 *   control frame : 55 AA | total length u16 LE | cmd | payload | sum16 LE
 *   image frame   : JPEG length u32 LE | JPEG bytes | sum16 LE (covers length)
 *   live mode     : cmd 0x11, must be repeated at least every ~1500 ms
 *   images        : 960 x 480, baseline JPEG, 4:2:0 chroma subsampling, <= 80 KB
 */
import LCD from "@SignalRGB/lcd";
import serial from "@SignalRGB/serial";

/* global
displayEnabled:readonly
faceLayout:readonly
mountOrientation:readonly
sideFillColor:readonly
lcdBrightness:readonly
maxFps:readonly
reencodeQuality:readonly
messageLanguage:readonly
shutdownBehavior:readonly
startupReport:readonly
*/

const PLUGIN_VERSION = "2.0.0";

export function Name() { return "Jungle Leopard LCD"; }
export function VendorId() { return 0x33C3; }
export function ProductId() { return 0x7788; }
export function Publisher() { return "lencraft151-cloud"; }
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [240, 120]; }
export function DefaultScale() { return 1.0; }
export function DeviceType() { return "lcd"; }
export function Type() { return "serial"; }
export function LedNames() { return []; }
export function LedPositions() { return []; }

/** Tools that hold the panel's COM port and would fight SignalRGB for it. */
export function ConflictingProcesses() {
	return ["JungleLeopardDisplayManager.exe", "Jungle Leopard Display.exe", "lcd_aio.exe"];
}

const LAYOUT_FULL = "Full Panel (960x480)";
const LAYOUT_SQUARE = "Original Square (480x480)";
const ORIENTATION_DEGREES = {
	"Landscape": 0,
	"Landscape (Upside Down)": 180,
	"Portrait (Rotated Right)": 90,
	"Portrait (Rotated Left)": 270,
};
const SHUTDOWN_RELEASE = "Release to Panel";
const SHUTDOWN_BACKLIGHT_OFF = "Backlight Off";

export function ControllableParameters() {
	return [
		{
			property: "displayEnabled", group: "", label: "Display On", type: "boolean",
			description: "Switches the pump display on or off. Off sets the backlight to 0 and shows black, " +
				"so the panel's own animation does not come back while SignalRGB is running.",
			default: "true",
		},
		{
			property: "faceLayout", group: "", label: "Face Layout", type: "combobox",
			description: "Full Panel renders the selected SignalRGB LCD face directly at 960x480. " +
				"Original Square renders it exactly as on a 480x480 LCD and centers it on the panel.",
			values: [LAYOUT_FULL, LAYOUT_SQUARE], default: LAYOUT_FULL,
		},
		{
			property: "mountOrientation", group: "", label: "Screen Orientation", type: "combobox",
			description: "How the magnetic screen is mounted on the pump. Portrait renders the face in a " +
				"480x960 viewport and rotates it for the panel. Pick the option that shows the face upright.",
			values: Object.keys(ORIENTATION_DEGREES), default: "Landscape",
		},
		{
			property: "sideFillColor", group: "", label: "Side Fill Color", type: "color", min: "0", max: "360",
			description: "Color of the unused panel area when a face does not cover the whole screen (e.g. Original Square).",
			default: "#000000",
		},
		{
			property: "lcdBrightness", group: "", label: "LCD Backlight", type: "number", min: "0", max: "100", step: "1",
			description: "Backlight brightness of the panel in percent.", default: "100", live: true,
		},
		{
			property: "maxFps", group: "", label: "Max Frame Rate", type: "number", min: "5", max: "30", step: "1",
			description: "Upper limit for frames sent to the panel per second. Lower values reduce CPU and USB load.",
			default: "30", live: true,
		},
		{
			property: "reencodeQuality", group: "", label: "Re-encode Quality", type: "number", min: "40", max: "95", step: "1",
			description: "JPEG quality used when a frame has to be converted for the panel (rotation, square layout, " +
				"incompatible face output). Lowered automatically if a frame would exceed the panel's 80 KB limit.",
			default: "85", live: true,
		},
		{
			property: "messageLanguage", group: "", label: "Message Language", type: "combobox",
			description: "Language of the status and error messages shown on the LCD and in SignalRGB notifications.",
			values: ["Deutsch", "English"], default: "Deutsch",
		},
		{
			property: "shutdownBehavior", group: "", label: "On Shutdown", type: "combobox",
			description: "What happens when SignalRGB closes or the system sleeps: hand the panel back to its own firmware, " +
				"or switch the backlight off.",
			values: [SHUTDOWN_RELEASE, SHUTDOWN_BACKLIGHT_OFF], default: SHUTDOWN_RELEASE,
		},
		{
			property: "startupReport", group: "", label: "Startup Diagnostics", type: "boolean",
			description: "Shows a SignalRGB notification after start with the connection diagnosis (COM port, write " +
				"result, panel answer). Useful when the display does not show the face.",
			default: "true",
		},
	];
}

/** One COM port per panel: whatever endpoint SignalRGB offers for 33C3:7788 is the panel. */
export function Validate() {
	return true;
}

export function Image() {
	return DEVICE_IMAGE_PNG_BASE64;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 960;
const PANEL_HEIGHT = 480;
const SQUARE_SIZE = 480;
const MAX_JPEG_BYTES = 80 * 1024;       // panel firmware limit per frame
const TARGET_JPEG_BYTES = 64 * 1024;    // re-encode target, leaves headroom
const KEEPALIVE_INTERVAL_MS = 1000;     // live mode lapses after ~1500 ms
const STILL_REFRESH_MS = 250;           // the panel only commits a frame once more bytes follow
const NO_FRAME_GRACE_MS = 1500;
const RECOVERY_INTERVAL_MS = 2000;
const INFO_TIMEOUT_MS = 800;
const DISPLAY_OFF_REFRESH_MS = 1000;   // black frame repeat while the display is switched off
const OVERSIZE_STREAK_LIMIT = 5;
const RAW_REPROBE_MS = 10000;
const MIN_REENCODE_QUALITY = 25;
const STATUS_QUALITY = 80;

const SERIAL = {
	BAUD_RATE: 115200,
	CHUNK_BYTES: 16384,
	READ_BYTES: 512,
	READ_SLICE_MS: 50,
	MAX_WRITE_ATTEMPTS: 64,
};

const CMD = {
	SET_LIGHT: 0x03,
	GET_INFO: 0x06,
	LIVE: 0x11,
	CLOSE: 0x21,          // firmware >= 3.1
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
	return value < min ? min : (value > max ? max : value);
}

function toNumber(value, fallback) {
	if (value === undefined || value === null || value === "") {
		return fallback;
	}

	const n = Number(value);

	return Number.isFinite(n) ? n : fallback;
}

function hexToRgb(hex, fallback = [0, 0, 0]) {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));

	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
}

function sum16(bytes, start, end) {
	let sum = 0;

	for (let i = start; i < end; i++) {
		sum += bytes[i] & 0xFF;
	}

	return sum & 0xFFFF;
}

/** Cheap content hash, only used to avoid re-sending identical frames too often. */
function hashBytes(bytes) {
	let h = bytes.length | 0;

	for (let i = 0; i < bytes.length; i++) {
		h = ((h << 5) - h + (bytes[i] & 0xFF)) | 0;
	}

	return h;
}

function isByteArray(value) {
	return value !== null && value !== undefined && typeof value === "object" && typeof value.length === "number";
}

function decodeUtf8(bytes) {
	let out = "";

	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] & 0xFF;

		if (b < 0x80) {
			out += String.fromCharCode(b);
		} else if (b >= 0xC0 && b < 0xE0 && i + 1 < bytes.length) {
			out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[++i] & 0x3F));
		} else if (b >= 0xE0 && b < 0xF0 && i + 2 < bytes.length) {
			out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
			i += 2;
		} else {
			out += "?";
		}
	}

	return out;
}

function codedError(code, message) {
	const error = new Error(message || code);
	error.code = code;

	return error;
}

/** Plugin messages go to the device console and, via toFile, to SignalRGB's log file. Never called per frame. */
function log(message) {
	device.log(`[JL-LCD] ${message}`, { toFile: true });
}

/** Short, log-friendly description of whatever a SignalRGB I/O call returned. */
function describeResult(result) {
	if (isByteArray(result)) {
		return `array(${result.length})`;
	}

	return result === undefined ? "undefined" : `${typeof result} ${String(result)}`;
}

// ---------------------------------------------------------------------------
// Panel protocol
// ---------------------------------------------------------------------------

function buildControlFrame(command, payload = []) {
	const total = payload.length + 7;
	const frame = [0x55, 0xAA, total & 0xFF, (total >> 8) & 0xFF, command & 0xFF];

	for (let i = 0; i < payload.length; i++) {
		frame.push(payload[i] & 0xFF);
	}

	const sum = sum16(frame, 0, frame.length);
	frame.push(sum & 0xFF, (sum >> 8) & 0xFF);

	return frame;
}

/**
 * An image frame starts with its length in little endian. If the low two bytes
 * of that length happen to be 55 AA, the frame would look like a control frame,
 * so a 5-byte JPEG comment segment is inserted to change the length.
 */
function avoidMagicCollision(jpeg) {
	if ((jpeg.length & 0xFFFF) !== 0xAA55 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) {
		return jpeg;
	}

	const out = new Uint8Array(jpeg.length + 5);
	out[0] = 0xFF;
	out[1] = 0xD8;
	out.set([0xFF, 0xFE, 0x00, 0x03, 0x00], 2);

	for (let i = 2; i < jpeg.length; i++) {
		out[i + 5] = jpeg[i];
	}

	return out;
}

function buildImageEnvelope(jpeg) {
	const n = jpeg.length;
	const out = new Uint8Array(n + 6);
	out[0] = n & 0xFF;
	out[1] = (n >>> 8) & 0xFF;
	out[2] = (n >>> 16) & 0xFF;
	out[3] = (n >>> 24) & 0xFF;

	let sum = out[0] + out[1] + out[2] + out[3];

	for (let i = 0; i < n; i++) {
		const b = jpeg[i] & 0xFF;
		out[i + 4] = b;
		sum += b;
	}

	out[n + 4] = sum & 0xFF;
	out[n + 5] = (sum >>> 8) & 0xFF;

	return out;
}

/** Finds the first complete 55 AA frame in a receive buffer. */
function extractReply(buffer) {
	for (let i = 0; i + 6 < buffer.length; i++) {
		if (buffer[i] !== 0x55 || buffer[i + 1] !== 0xAA) {
			continue;
		}

		const declared = buffer[i + 2] | (buffer[i + 3] << 8);

		if (declared < 7 || i + declared > buffer.length) {
			continue;
		}

		const expected = buffer[i + declared - 2] | (buffer[i + declared - 1] << 8);

		return {
			command: buffer[i + 4],
			text: decodeUtf8(buffer.slice(i + 5, i + declared - 2)),
			checksumOk: expected === sum16(buffer, i, i + declared - 2),
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Serial transport: SignalRGB's official @SignalRGB/serial module, the same one its own Turzx LCD and
// HYTE CNVS plugins use. SignalRGB knows which COM port belongs to this device, so connect() needs no
// port name.
// ---------------------------------------------------------------------------

function messageOf(e) {
	return e && e.message ? e.message : String(e);
}

/** Bytes from whatever a serial read returned: number arrays, typed arrays, ArrayBuffers or latin-1 strings. */
function toBytes(value) {
	if (value === null || value === undefined) {
		return [];
	}

	if (typeof value === "string") {
		return Array.from(value, (c) => c.charCodeAt(0) & 0xFF);
	}

	if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
		return Array.from(new Uint8Array(value));
	}

	return isByteArray(value) ? Array.from(value, (b) => b & 0xFF) : [];
}

const hex4 = (value) => (typeof value === "number" ? value.toString(16).toUpperCase().padStart(4, "0") : String(value));

/** serial.write() returns the number of bytes written; -1 (or false) means the write failed. */
function writeFailed(result) {
	return result === false || (typeof result === "number" && result < 0);
}

class SerialLink {
	constructor() {
		this.lastKeepAlive = 0;
		this.resetDiagnostics();
	}

	resetDiagnostics() {
		this.portName = "";
		this.portInfo = "-";
		this.connectNote = "not tried";
		this.firstWriteResult = "none";
		this.infoBytesReceived = 0;
		this.probeNote = "-";
	}

	/** True if this SignalRGB build gives plugins access to COM ports (the serial module, SignalRGB 2.5+). */
	static available() {
		return Boolean(serial) && typeof serial.connect === "function" && typeof serial.write === "function" &&
			typeof serial.isConnected === "function";
	}

	isOpen() {
		try {
			return serial.isConnected() === true;
		} catch (e) {
			return false;
		}
	}

	portLabel() {
		return this.portName || "COM-Port";
	}

	/** Port name and USB identity as SignalRGB reports them, for the diagnosis. */
	readPortInfo() {
		try {
			const name = typeof serial.getPortName === "function" ? serial.getPortName() : "";
			this.portName = name ? String(name) : this.portName;
		} catch (e) {
			// Keep what we had.
		}

		try {
			const info = typeof serial.getDeviceInfo === "function" ? serial.getDeviceInfo() : null;

			if (info && typeof info === "object") {
				const id = info.vid !== undefined ? `${hex4(info.vid)}:${hex4(info.pid)}` : "?";
				this.portInfo = info.driverDesc ? `${id}, ${info.driverDesc}` : id;
			}
		} catch (e) {
			this.portInfo = `unavailable (${messageOf(e)})`;
		}
	}

	/** Opens the panel's COM port at 115200 8N1 (advisory on CDC-ACM, matches the vendor app). */
	open() {
		if (!SerialLink.available()) {
			this.connectNote = "serial module missing";
			throw codedError("no-serial", "SignalRGB serial module not available");
		}

		if (this.isOpen()) {
			this.readPortInfo();
			this.connectNote = "already open";

			return;
		}

		this.disconnect();

		let result;

		try {
			result = serial.connect({ baudRate: SERIAL.BAUD_RATE, dataBits: 8, stopBits: "One", parity: "None" });
		} catch (e) {
			this.readPortInfo();
			this.connectNote = `failed (${messageOf(e)})`;
			throw codedError("port-busy", `${this.portLabel()}: ${messageOf(e)}`);
		}

		this.readPortInfo();

		const open = this.isOpen();
		this.connectNote = `${open ? "open" : "not open"} (${describeResult(result)})`;

		if (!open) {
			throw codedError("port-busy", `${this.portLabel()} could not be opened`);
		}
	}

	disconnect() {
		try {
			if (typeof serial.disconnect === "function") {
				serial.disconnect();
			}
		} catch (e) {
			// Nothing was open.
		}
	}

	/** Writes all bytes; throws if SignalRGB reports a failed write or the port went away. */
	write(bytes) {
		for (let offset = 0; offset < bytes.length; offset += SERIAL.CHUNK_BYTES) {
			const length = Math.min(SERIAL.CHUNK_BYTES, bytes.length - offset);
			const chunk = new Array(length);

			for (let i = 0; i < length; i++) {
				chunk[i] = bytes[offset + i] & 0xFF;
			}

			this.writeChunk(chunk);
		}
	}

	writeChunk(chunk) {
		let pending = chunk;

		// A short (positive) count means only part was taken: send the rest. Bounded, so a port that keeps
		// taking almost nothing cannot hang the render thread; what is left then is an error, never dropped.
		for (let attempt = 0; pending.length > 0; attempt++) {
			if (attempt >= SERIAL.MAX_WRITE_ATTEMPTS) {
				throw codedError("serial-write", `write stalled (${pending.length} B left)`);
			}

			let result;

			try {
				result = serial.write(pending);
			} catch (e) {
				throw codedError("serial-write", `write failed (${messageOf(e)})`);
			}

			if (this.firstWriteResult === "none") {
				this.firstWriteResult = describeResult(result);
			}

			if (writeFailed(result) || (result === 0 && !this.isOpen())) {
				throw codedError("serial-write", `write failed (${describeResult(result)})`);
			}

			pending = typeof result === "number" && result > 0 && result < pending.length ? pending.slice(result) : [];
		}
	}

	/** Up to `max` received bytes, waiting at most `timeoutMs`; null if this SignalRGB build cannot read. */
	read(max, timeoutMs) {
		if (typeof serial.read === "function") {
			return toBytes(serial.read(max, timeoutMs));
		}

		if (typeof serial.readAll === "function") {
			return toBytes(serial.readAll());
		}

		return null;
	}

	/** Drops stale bytes (e.g. a late answer from before a reconnect). */
	drain() {
		try {
			if (typeof serial.readAll === "function") {
				serial.readAll();
			}
		} catch (e) {
			// Nothing buffered.
		}
	}

	/** JPEG end-of-image markers flush a half-received frame, then four zero bytes (vendor app sequence). */
	flush() {
		this.write([0xFF, 0xD9, 0xFF, 0xD9]);
		device.pause(50);
		this.write([0x00, 0x00, 0x00, 0x00]);
		device.pause(200);
	}

	flushEndOfImage() {
		this.write([0xFF, 0xD9, 0xFF, 0xD9]);
	}

	sendCommand(command, payload = []) {
		this.write(buildControlFrame(command, payload));
	}

	setBacklight(percent) {
		this.sendCommand(CMD.SET_LIGHT, [clamp(Math.round(percent), 0, 100)]);
	}

	keepAlive(now) {
		this.sendCommand(CMD.LIVE);
		this.lastKeepAlive = now;
	}

	/** Hands the panel back to its own firmware (command exists from firmware 3.1 on). */
	release() {
		this.sendCommand(CMD.CLOSE);
	}

	sendJpeg(jpeg) {
		this.write(buildImageEnvelope(avoidMagicCollision(jpeg)));
	}

	/**
	 * Sends the info request (0x06) and collects the JSON reply. A panel that stays silent is not an error:
	 * some firmwares only answer while DTR is set, and frames are accepted either way.
	 */
	requestInfo(timeoutMs) {
		this.drain();
		this.sendCommand(CMD.GET_INFO);

		const deadline = Date.now() + timeoutMs;
		const buffer = [];

		while (Date.now() < deadline) {
			const started = Date.now();
			let chunk;

			try {
				chunk = this.read(SERIAL.READ_BYTES, SERIAL.READ_SLICE_MS);
			} catch (e) {
				return { reply: null, note: `read failed (${messageOf(e)})` };
			}

			if (chunk === null) {
				return { reply: null, note: "read not supported" };
			}

			this.infoBytesReceived += chunk.length;

			for (let i = 0; i < chunk.length; i++) {
				buffer.push(chunk[i]);
			}

			const reply = extractReply(buffer);

			if (reply) {
				return { reply, note: `reply ${buffer.length} B` };
			}

			// read() normally waits for data itself; only pause if it returned at once.
			if (chunk.length === 0 && Date.now() - started < 5) {
				device.pause(SERIAL.READ_SLICE_MS);
			}
		}

		return { reply: null, note: `no reply (${buffer.length} B)` };
	}
}

// ---------------------------------------------------------------------------
// Device info (reply to 0x06 is JSON, field names vary between firmwares)
// ---------------------------------------------------------------------------

function flattenJson(value, prefix, out) {
	if (value === null || value === undefined) {
		return out;
	}

	if (typeof value === "object") {
		for (const key of Object.keys(value)) {
			flattenJson(value[key], prefix ? `${prefix}.${key}` : key, out);
		}
	} else {
		out.push([prefix.toLowerCase(), value]);
	}

	return out;
}

function parseJsonObject(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");

	if (start < 0 || end <= start) {
		return null;
	}

	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch (e) {
		return null;
	}
}

const INFO_FIELDS = [
	{ target: "model", key: /(model|name|screen|lcd|panel|type)/, value: (v) => (typeof v === "string" && /[a-z]/i.test(v) ? v : null) },
	{ target: "version", key: /(^ver|version|^fw|firmware)/, value: (v) => {
		const m = /(\d+)\.(\d+)/.exec(String(v));
		const n = m ? Number(`${m[1]}.${m[2]}`) : toNumber(v, NaN);

		return Number.isNaN(n) ? null : n;
	} },
	{ target: "width", key: /(^w$|width|^resx$|^screenw$|^lcdw$)/, value: (v) => (toNumber(v, 0) > 0 ? toNumber(v, 0) : null) },
	{ target: "height", key: /(^h$|height|^resy$|^screenh$|^lcdh$)/, value: (v) => (toNumber(v, 0) > 0 ? toNumber(v, 0) : null) },
];

function parseDeviceInfo(text) {
	const info = { raw: String(text || ""), model: "", version: NaN, width: 0, height: 0 };
	const found = new Set();

	for (const [path, value] of flattenJson(parseJsonObject(info.raw), "", [])) {
		const key = path.split(".").pop();

		for (const field of INFO_FIELDS) {
			const parsed = found.has(field.target) || !field.key.test(key) ? null : field.value(value);

			if (parsed !== null) {
				info[field.target] = parsed;
				found.add(field.target);
			}
		}
	}

	// Firmwares that answer with plain text still tend to carry the model string or a WxH resolution.
	const model = /[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*-\d+(?:\.\d+)?inch(?:-[A-Za-z]+)?/.exec(info.raw);
	const resolution = /(\d{3,4})\s*[x*×X]\s*(\d{3,4})/.exec(info.raw);

	if (!info.model && model) {
		info.model = model[0];
	}

	if (!info.width && resolution) {
		info.width = Number(resolution[1]);
		info.height = Number(resolution[2]);
	}

	return info;
}

/** Only an explicitly reported, different resolution blocks the plugin: 33C3:7788 is a generic CherryUSB demo ID. */
function assessPanel(info) {
	if (!info) {
		return { status: "unknown", reason: "no-reply" };
	}

	if (info.width > 0 && info.height > 0) {
		const fits = (info.width === PANEL_WIDTH && info.height === PANEL_HEIGHT) ||
			(info.width === PANEL_HEIGHT && info.height === PANEL_WIDTH);

		return fits ? { status: "ok", reason: "resolution" } : { status: "mismatch", reason: `${info.width}x${info.height}` };
	}

	if (/5\.5\s*inch/i.test(info.model)) {
		return { status: "ok", reason: "model" };
	}

	return { status: "unknown", reason: info.model ? "unknown-model" : "no-model" };
}

// ---------------------------------------------------------------------------
// JPEG inspection (what SignalRGB hands us vs. what the panel can decode)
// ---------------------------------------------------------------------------

function isSofMarker(marker) {
	return marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
}

// eslint-disable-next-line complexity
function inspectJpeg(bytes) {
	const result = {
		valid: false, reason: "", sofMarker: 0, baseline: false, progressive: false,
		precision: 0, width: 0, height: 0, components: 0, sampling: [], restartInterval: 0,
	};
	const n = isByteArray(bytes) ? bytes.length : 0;

	if (n < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
		result.reason = "not-jpeg";

		return result;
	}

	let i = 2;
	let hasScan = false;

	while (i + 3 < n) {
		if (bytes[i] !== 0xFF) {
			result.reason = "corrupt";

			return result;
		}

		let marker = bytes[i + 1];

		while (marker === 0xFF && i + 2 < n) {
			i++;
			marker = bytes[i + 1];
		}

		if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) {
			i += 2;
			continue;
		}

		if (marker === 0xD9) {
			break;
		}

		const segmentLength = (bytes[i + 2] << 8) | bytes[i + 3];

		if (segmentLength < 2 || i + 2 + segmentLength > n) {
			result.reason = "truncated";

			return result;
		}

		if (isSofMarker(marker) && segmentLength >= 8) {
			result.sofMarker = marker;
			result.baseline = marker === 0xC0;
			result.progressive = marker === 0xC2;
			result.precision = bytes[i + 4];
			result.height = (bytes[i + 5] << 8) | bytes[i + 6];
			result.width = (bytes[i + 7] << 8) | bytes[i + 8];
			result.components = bytes[i + 9];

			for (let c = 0; c < result.components && 12 + c * 3 < 2 + segmentLength; c++) {
				const factors = bytes[i + 11 + c * 3];
				result.sampling.push([factors >> 4, factors & 0x0F]);
			}
		} else if (marker === 0xDD && segmentLength >= 4) {
			result.restartInterval = (bytes[i + 4] << 8) | bytes[i + 5];
		} else if (marker === 0xDA) {
			hasScan = true;
			break;
		}

		i += 2 + segmentLength;
	}

	if (!result.sofMarker) {
		result.reason = "no-frame-header";
	} else if (!hasScan) {
		result.reason = "no-scan";
	} else {
		result.valid = true;
	}

	return result;
}

/** Returns "" if the JPEG can go to the panel unchanged, otherwise a reason code. */
// eslint-disable-next-line complexity
function panelIncompatibility(info, byteLength) {
	if (!info.valid) {
		return info.reason || "not-jpeg";
	}

	if (!info.baseline) {
		return info.progressive ? "progressive" : "unsupported-coding";
	}

	if (info.precision !== 8 || info.components !== 3) {
		return "color-format";
	}

	const s = info.sampling;

	if (s.length !== 3 || s[0][0] !== 2 || s[0][1] !== 2 || s[1][0] !== 1 || s[1][1] !== 1 || s[2][0] !== 1 || s[2][1] !== 1) {
		return "subsampling";
	}

	if (info.restartInterval) {
		return "restart-markers";
	}

	if (info.width !== PANEL_WIDTH || info.height !== PANEL_HEIGHT) {
		return "size";
	}

	if (byteLength > MAX_JPEG_BYTES) {
		return "too-large";
	}

	return "";
}

// ---------------------------------------------------------------------------
// BMP decoding (uncompressed frames from LCD.getFrame({format: "BMP"}))
// ---------------------------------------------------------------------------

function readU16(b, o) { return b[o] | (b[o + 1] << 8); }

function readU32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function readI32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }

function maskInfo(mask) {
	if (!mask) {
		return null;
	}

	let shift = 0;
	let bits = 0;

	while (((mask >>> shift) & 1) === 0 && shift < 32) {
		shift++;
	}

	while (((mask >>> (shift + bits)) & 1) === 1 && shift + bits < 32) {
		bits++;
	}

	return { mask, shift, max: bits >= 32 ? 0xFFFFFFFF : (2 ** bits) - 1 };
}

function maskValue(pixel, info) {
	if (!info) {
		return 0;
	}

	const raw = (pixel & info.mask) >>> info.shift;

	return info.max === 255 ? raw : Math.round(raw * 255 / info.max);
}

// eslint-disable-next-line complexity
function decodeBmp(bytes) {
	if (!isByteArray(bytes) || bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4D) {
		throw codedError("bmp-signature");
	}

	const dataOffset = readU32(bytes, 10);
	const dibSize = readU32(bytes, 14);
	let width;
	let height;
	let bpp;
	let compression = 0;

	if (dibSize === 12) {
		width = readU16(bytes, 18);
		height = readU16(bytes, 20);
		bpp = readU16(bytes, 24);
	} else {
		if (bytes.length < 54) {
			throw codedError("bmp-truncated");
		}

		width = readI32(bytes, 18);
		height = readI32(bytes, 22);
		bpp = readU16(bytes, 28);
		compression = readU32(bytes, 30);
	}

	const topDown = height < 0;
	height = Math.abs(height);

	if (width <= 0 || height === 0 || width > 4096 || height > 4096) {
		throw codedError("bmp-size");
	}

	let masks = null;

	if (bpp === 32 && (compression === 3 || compression === 6)) {
		const hasAlphaMask = compression === 6 || dibSize >= 56;
		masks = [readU32(bytes, 54), readU32(bytes, 58), readU32(bytes, 62), hasAlphaMask ? readU32(bytes, 66) : 0];
	} else if (bpp === 32 && compression === 0) {
		masks = [0x00FF0000, 0x0000FF00, 0x000000FF, 0];
	} else if (!(bpp === 24 && compression === 0)) {
		throw codedError("bmp-format", `${bpp} bpp, compression ${compression}`);
	}

	const stride = Math.floor((bpp * width + 31) / 32) * 4;

	if (dataOffset + stride * height > bytes.length) {
		throw codedError("bmp-truncated");
	}

	const rgb = new Uint8Array(width * height * 3);
	const standard = masks && masks[0] === 0x00FF0000 && masks[1] === 0x0000FF00 && masks[2] === 0x000000FF;
	const alphaMask = masks ? masks[3] : 0;
	const alpha = alphaMask ? new Uint8Array(width * height) : null;
	const infos = masks ? masks.map(maskInfo) : null;
	let anyAlpha = false;

	for (let y = 0; y < height; y++) {
		const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
		let o = y * width * 3;

		for (let x = 0; x < width; x++, o += 3) {
			if (bpp === 24) {
				const p = row + x * 3;
				rgb[o] = bytes[p + 2];
				rgb[o + 1] = bytes[p + 1];
				rgb[o + 2] = bytes[p];
				continue;
			}

			const p = row + x * 4;

			if (standard) {
				rgb[o] = bytes[p + 2];
				rgb[o + 1] = bytes[p + 1];
				rgb[o + 2] = bytes[p];
			} else {
				const pixel = readU32(bytes, p);
				rgb[o] = maskValue(pixel, infos[0]);
				rgb[o + 1] = maskValue(pixel, infos[1]);
				rgb[o + 2] = maskValue(pixel, infos[2]);
			}

			if (alpha) {
				const a = standard && alphaMask === 0xFF000000 ? bytes[p + 3] : maskValue(readU32(bytes, p), infos[3]);
				alpha[y * width + x] = a;
				anyAlpha = anyAlpha || a !== 0;
			}
		}
	}

	// An alpha channel that is zero everywhere is an unused "X" byte, otherwise composite over black.
	if (alpha && anyAlpha) {
		for (let i = 0, o = 0; i < alpha.length; i++, o += 3) {
			const a = alpha[i];

			if (a !== 255) {
				rgb[o] = (rgb[o] * a + 127) / 255;
				rgb[o + 1] = (rgb[o + 1] * a + 127) / 255;
				rgb[o + 2] = (rgb[o + 2] * a + 127) / 255;
			}
		}
	}

	return { width, height, rgb };
}

// ---------------------------------------------------------------------------
// Composition: face viewport -> physical 960x480 panel (layout + rotation)
// ---------------------------------------------------------------------------

function viewportFor(settings) {
	if (settings.layout === LAYOUT_SQUARE) {
		return [SQUARE_SIZE, SQUARE_SIZE];
	}

	return settings.rotation === 90 || settings.rotation === 270 ? [PANEL_HEIGHT, PANEL_WIDTH] : [PANEL_WIDTH, PANEL_HEIGHT];
}

function needsHostTransform(settings) {
	return settings.layout === LAYOUT_SQUARE || settings.rotation !== 0;
}

/**
 * For every panel pixel, the index of the source pixel it shows (or -1 for the
 * fill area). The source is fitted ("contain") and centered on the logical,
 * upright canvas, which is then rotated onto the panel.
 */
// eslint-disable-next-line complexity
function buildPixelMap(srcWidth, srcHeight, rotation, panelWidth = PANEL_WIDTH, panelHeight = PANEL_HEIGHT) {
	const portrait = rotation === 90 || rotation === 270;
	const logicalWidth = portrait ? panelHeight : panelWidth;
	const logicalHeight = portrait ? panelWidth : panelHeight;
	const scale = Math.min(logicalWidth / srcWidth, logicalHeight / srcHeight);
	const drawWidth = Math.max(1, Math.round(srcWidth * scale));
	const drawHeight = Math.max(1, Math.round(srcHeight * scale));
	const offsetX = Math.floor((logicalWidth - drawWidth) / 2);
	const offsetY = Math.floor((logicalHeight - drawHeight) / 2);
	const map = new Int32Array(panelWidth * panelHeight);

	for (let py = 0, i = 0; py < panelHeight; py++) {
		for (let px = 0; px < panelWidth; px++, i++) {
			let lx = px;
			let ly = py;

			if (rotation === 90) {          // panel turned clockwise: content turned counter-clockwise
				lx = logicalWidth - 1 - py;
				ly = px;
			} else if (rotation === 180) {
				lx = panelWidth - 1 - px;
				ly = panelHeight - 1 - py;
			} else if (rotation === 270) {   // panel turned counter-clockwise
				lx = py;
				ly = logicalHeight - 1 - px;
			}

			const dx = lx - offsetX;
			const dy = ly - offsetY;

			if (dx < 0 || dy < 0 || dx >= drawWidth || dy >= drawHeight) {
				map[i] = -1;
			} else {
				const sx = Math.min(srcWidth - 1, Math.floor(dx * srcWidth / drawWidth));
				const sy = Math.min(srcHeight - 1, Math.floor(dy * srcHeight / drawHeight));
				map[i] = sy * srcWidth + sx;
			}
		}
	}

	return map;
}

function composeFrame(image, map, fill, out) {
	const src = image.rgb;

	for (let i = 0, o = 0; i < map.length; i++, o += 3) {
		const s = map[i];

		if (s < 0) {
			out[o] = fill[0];
			out[o + 1] = fill[1];
			out[o + 2] = fill[2];
		} else {
			const so = s * 3;
			out[o] = src[so];
			out[o + 1] = src[so + 1];
			out[o + 2] = src[so + 2];
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// Baseline JPEG encoder (YCbCr 4:2:0, standard Huffman tables)
// ---------------------------------------------------------------------------

const ZIGZAG = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const STD_LUMA_QUANT = [
	16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
	14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
	18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
	49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

const STD_CHROMA_QUANT = [
	17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
	24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

const HUFFMAN_SPECS = {
	dcLuma: {
		bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
		values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	dcChroma: {
		bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
		values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	acLuma: {
		bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7D],
		values: [
			0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
			0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
			0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
			0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
			0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
			0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
			0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
			0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
			0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
			0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
			0xF9, 0xFA,
		],
	},
	acChroma: {
		bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
		values: [
			0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
			0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
			0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
			0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
			0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
			0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
			0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
			0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
			0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
			0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
			0xF9, 0xFA,
		],
	},
};

const AAN_SCALE = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];

function buildHuffmanCodes(spec) {
	const codes = new Int32Array(256);
	const sizes = new Int32Array(256);
	let code = 0;
	let k = 0;

	for (let length = 1; length <= 16; length++) {
		for (let i = 0; i < spec.bits[length - 1]; i++) {
			const symbol = spec.values[k++];
			codes[symbol] = code;
			sizes[symbol] = length;
			code++;
		}

		code <<= 1;
	}

	return { codes, sizes };
}

function scaleQuantTable(base, quality) {
	const q = clamp(Math.round(quality), 1, 100);
	const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
	const table = new Int32Array(64);

	for (let i = 0; i < 64; i++) {
		table[i] = clamp(Math.floor((base[i] * scale + 50) / 100), 1, 255);
	}

	return table;
}

/** In-place forward DCT (AAN float algorithm, as in libjpeg's jfdctflt.c). */
function forwardDct(d) {
	for (let pass = 0; pass < 2; pass++) {
		const step = pass === 0 ? 1 : 8;
		const next = pass === 0 ? 8 : 1;

		for (let line = 0, base = 0; line < 8; line++, base += next) {
			const i0 = base;
			const i1 = base + step;
			const i2 = base + 2 * step;
			const i3 = base + 3 * step;
			const i4 = base + 4 * step;
			const i5 = base + 5 * step;
			const i6 = base + 6 * step;
			const i7 = base + 7 * step;

			const t0 = d[i0] + d[i7];
			const t7 = d[i0] - d[i7];
			const t1 = d[i1] + d[i6];
			const t6 = d[i1] - d[i6];
			const t2 = d[i2] + d[i5];
			const t5 = d[i2] - d[i5];
			const t3 = d[i3] + d[i4];
			const t4 = d[i3] - d[i4];

			let t10 = t0 + t3;
			const t13 = t0 - t3;
			let t11 = t1 + t2;
			let t12 = t1 - t2;

			d[i0] = t10 + t11;
			d[i4] = t10 - t11;

			const z1 = (t12 + t13) * 0.707106781;
			d[i2] = t13 + z1;
			d[i6] = t13 - z1;

			t10 = t4 + t5;
			t11 = t5 + t6;
			t12 = t6 + t7;

			const z5 = (t10 - t12) * 0.382683433;
			const z2 = 0.541196100 * t10 + z5;
			const z4 = 1.306562965 * t12 + z5;
			const z3 = t11 * 0.707106781;
			const z11 = t7 + z3;
			const z13 = t7 - z3;

			d[i5] = z13 + z2;
			d[i3] = z13 - z2;
			d[i1] = z11 + z4;
			d[i7] = z11 - z4;
		}
	}
}

const BIT_LENGTH = (() => {
	const table = new Uint8Array(2048);

	for (let v = 1; v < 2048; v++) {
		table[v] = table[v >> 1] + 1;
	}

	return table;
})();

function bitLength(magnitude) {
	if (magnitude < 2048) {
		return BIT_LENGTH[magnitude];
	}

	let n = 0;

	while (magnitude) {
		n++;
		magnitude >>>= 1;
	}

	return n;
}

class JpegEncoder {
	constructor() {
		this.dcLuma = buildHuffmanCodes(HUFFMAN_SPECS.dcLuma);
		this.acLuma = buildHuffmanCodes(HUFFMAN_SPECS.acLuma);
		this.dcChroma = buildHuffmanCodes(HUFFMAN_SPECS.dcChroma);
		this.acChroma = buildHuffmanCodes(HUFFMAN_SPECS.acChroma);
		this.tableCache = new Map();
		this.out = new Uint8Array(256 * 1024);
		this.pos = 0;
		this.bitBuffer = 0;
		this.bitCount = 0;
		this.block = new Float32Array(64);
		this.coefficients = new Int32Array(64);
		this.planeKey = "";
		this.adaptiveQuality = 0;
		this.preferredQuality = 0;
	}

	tablesFor(quality) {
		const q = clamp(Math.round(quality), 1, 100);
		let tables = this.tableCache.get(q);

		if (tables) {
			return tables;
		}

		const lumaQuant = scaleQuantTable(STD_LUMA_QUANT, q);
		const chromaQuant = scaleQuantTable(STD_CHROMA_QUANT, q);
		const divisors = (quant) => {
			const f = new Float32Array(64);

			for (let i = 0; i < 64; i++) {
				f[i] = 1 / (quant[i] * AAN_SCALE[i >> 3] * AAN_SCALE[i & 7] * 8);
			}

			return f;
		};

		tables = { lumaQuant, chromaQuant, lumaDiv: divisors(lumaQuant), chromaDiv: divisors(chromaQuant) };
		this.tableCache.set(q, tables);

		return tables;
	}

	ensureCapacity(extra) {
		if (this.pos + extra <= this.out.length) {
			return;
		}

		const grown = new Uint8Array(Math.max(this.out.length * 2, this.pos + extra));
		grown.set(this.out.subarray(0, this.pos));
		this.out = grown;
	}

	writeByte(value) {
		this.out[this.pos++] = value & 0xFF;
	}

	writeWord(value) {
		this.writeByte(value >> 8);
		this.writeByte(value);
	}

	writeBits(code, size) {
		this.bitBuffer = (this.bitBuffer << size) | (code & ((1 << size) - 1));
		this.bitCount += size;

		while (this.bitCount >= 8) {
			const byte = (this.bitBuffer >>> (this.bitCount - 8)) & 0xFF;
			this.out[this.pos++] = byte;

			if (byte === 0xFF) {
				this.out[this.pos++] = 0x00;
			}

			this.bitCount -= 8;
		}

		this.bitBuffer &= (1 << this.bitCount) - 1;
	}

	writeHeaders(width, height, tables) {
		this.writeWord(0xFFD8);
		this.writeWord(0xFFE0);
		this.writeWord(16);
		[0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00].forEach((b) => this.writeByte(b));

		this.writeWord(0xFFDB);
		this.writeWord(132);
		this.writeByte(0x00);
		ZIGZAG.forEach((natural) => this.writeByte(tables.lumaQuant[natural]));
		this.writeByte(0x01);
		ZIGZAG.forEach((natural) => this.writeByte(tables.chromaQuant[natural]));

		this.writeWord(0xFFC0);
		this.writeWord(17);
		this.writeByte(8);
		this.writeWord(height);
		this.writeWord(width);
		this.writeByte(3);
		[[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 1]].forEach(([id, factors, table]) => {
			this.writeByte(id);
			this.writeByte(factors);
			this.writeByte(table);
		});

		this.writeWord(0xFFC4);
		this.writeWord(418);
		[[0x00, HUFFMAN_SPECS.dcLuma], [0x10, HUFFMAN_SPECS.acLuma], [0x01, HUFFMAN_SPECS.dcChroma], [0x11, HUFFMAN_SPECS.acChroma]]
			.forEach(([classAndId, spec]) => {
				this.writeByte(classAndId);
				spec.bits.forEach((b) => this.writeByte(b));
				spec.values.forEach((v) => this.writeByte(v));
			});

		this.writeWord(0xFFDA);
		this.writeWord(12);
		this.writeByte(3);
		[[1, 0x00], [2, 0x11], [3, 0x11]].forEach(([id, huffmanSelectors]) => {
			this.writeByte(id);
			this.writeByte(huffmanSelectors);
		});
		this.writeByte(0);
		this.writeByte(63);
		this.writeByte(0);
	}

	/** Converts RGB to level-shifted Y (full size) and Cb/Cr (2x2 averaged), padded to whole MCUs. */
	preparePlanes(rgb, width, height) {
		const paddedWidth = Math.ceil(width / 16) * 16;
		const paddedHeight = Math.ceil(height / 16) * 16;
		const chromaWidth = paddedWidth >> 1;
		const chromaHeight = paddedHeight >> 1;
		const key = `${paddedWidth}x${paddedHeight}`;

		if (this.planeKey !== key) {
			this.lumaPlane = new Float32Array(paddedWidth * paddedHeight);
			this.cbPlane = new Float32Array(chromaWidth * chromaHeight);
			this.crPlane = new Float32Array(chromaWidth * chromaHeight);
			this.planeKey = key;
		}

		const Y = this.lumaPlane;

		for (let y = 0; y < paddedHeight; y++) {
			const rowBase = Math.min(y, height - 1) * width;

			for (let x = 0; x < paddedWidth; x++) {
				const o = (rowBase + Math.min(x, width - 1)) * 3;
				Y[y * paddedWidth + x] = 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2] - 128;
			}
		}

		for (let cy = 0; cy < chromaHeight; cy++) {
			const y0 = Math.min(cy * 2, height - 1) * width;
			const y1 = Math.min(cy * 2 + 1, height - 1) * width;

			for (let cx = 0; cx < chromaWidth; cx++) {
				const x0 = Math.min(cx * 2, width - 1);
				const x1 = Math.min(cx * 2 + 1, width - 1);
				const a = (y0 + x0) * 3;
				const b = (y0 + x1) * 3;
				const c = (y1 + x0) * 3;
				const d = (y1 + x1) * 3;
				const r = (rgb[a] + rgb[b] + rgb[c] + rgb[d]) * 0.25;
				const g = (rgb[a + 1] + rgb[b + 1] + rgb[c + 1] + rgb[d + 1]) * 0.25;
				const bl = (rgb[a + 2] + rgb[b + 2] + rgb[c + 2] + rgb[d + 2]) * 0.25;
				const i = cy * chromaWidth + cx;
				this.cbPlane[i] = -0.168736 * r - 0.331264 * g + 0.5 * bl;
				this.crPlane[i] = 0.5 * r - 0.418688 * g - 0.081312 * bl;
			}
		}

		return { paddedWidth, paddedHeight, chromaWidth };
	}

	// eslint-disable-next-line complexity
	encodeBlock(plane, stride, x0, y0, divisors, dc, ac, previousDc) {
		const block = this.block;
		const coefficients = this.coefficients;

		for (let y = 0, k = 0; y < 8; y++) {
			const row = (y0 + y) * stride + x0;

			for (let x = 0; x < 8; x++) {
				block[k++] = plane[row + x];
			}
		}

		forwardDct(block);

		// Baseline Huffman tables cover magnitudes up to 1023 (AC); clamp the rare rounding overshoot at Q=1.
		for (let i = 0; i < 64; i++) {
			const v = Math.round(block[i] * divisors[i]);
			coefficients[i] = v > 1023 ? 1023 : (v < -1023 ? -1023 : v);
		}

		const value = coefficients[0];
		const diff = value - previousDc;
		const diffBits = bitLength(diff < 0 ? -diff : diff);
		this.writeBits(dc.codes[diffBits], dc.sizes[diffBits]);

		if (diffBits) {
			this.writeBits(diff < 0 ? diff + (1 << diffBits) - 1 : diff, diffBits);
		}

		let run = 0;

		for (let k = 1; k < 64; k++) {
			const v = coefficients[ZIGZAG[k]];

			if (v === 0) {
				run++;
				continue;
			}

			while (run > 15) {
				this.writeBits(ac.codes[0xF0], ac.sizes[0xF0]);
				run -= 16;
			}

			const size = bitLength(v < 0 ? -v : v);
			const symbol = (run << 4) | size;
			this.writeBits(ac.codes[symbol], ac.sizes[symbol]);
			this.writeBits(v < 0 ? v + (1 << size) - 1 : v, size);
			run = 0;
		}

		if (run > 0) {
			this.writeBits(ac.codes[0x00], ac.sizes[0x00]);
		}

		return value;
	}

	/** Encodes width x height RGB bytes into a baseline 4:2:0 JPEG. */
	encode(rgb, width, height, quality) {
		const tables = this.tablesFor(quality);
		const { paddedWidth, paddedHeight, chromaWidth } = this.preparePlanes(rgb, width, height);

		this.pos = 0;
		this.bitBuffer = 0;
		this.bitCount = 0;
		this.ensureCapacity(1024);
		this.writeHeaders(width, height, tables);

		let dcY = 0;
		let dcCb = 0;
		let dcCr = 0;

		for (let my = 0; my < paddedHeight; my += 16) {
			for (let mx = 0; mx < paddedWidth; mx += 16) {
				this.ensureCapacity(4096);
				dcY = this.encodeBlock(this.lumaPlane, paddedWidth, mx, my, tables.lumaDiv, this.dcLuma, this.acLuma, dcY);
				dcY = this.encodeBlock(this.lumaPlane, paddedWidth, mx + 8, my, tables.lumaDiv, this.dcLuma, this.acLuma, dcY);
				dcY = this.encodeBlock(this.lumaPlane, paddedWidth, mx, my + 8, tables.lumaDiv, this.dcLuma, this.acLuma, dcY);
				dcY = this.encodeBlock(this.lumaPlane, paddedWidth, mx + 8, my + 8, tables.lumaDiv, this.dcLuma, this.acLuma, dcY);
				dcCb = this.encodeBlock(this.cbPlane, chromaWidth, mx >> 1, my >> 1, tables.chromaDiv, this.dcChroma, this.acChroma, dcCb);
				dcCr = this.encodeBlock(this.crPlane, chromaWidth, mx >> 1, my >> 1, tables.chromaDiv, this.dcChroma, this.acChroma, dcCr);
			}
		}

		this.ensureCapacity(8);

		if (this.bitCount > 0) {
			const pad = 8 - this.bitCount;
			this.writeBits((1 << pad) - 1, pad);
		}

		this.writeWord(0xFFD9);

		return this.out.slice(0, this.pos);
	}

	/**
	 * Encodes within the panel's size budget. Quality steps down when a frame is
	 * too large and creeps back up towards the preferred value when there is room.
	 * Returns null if even the lowest quality exceeds the hard limit.
	 */
	encodeWithinBudget(rgb, width, height, preferredQuality, targetBytes = TARGET_JPEG_BYTES, hardLimit = MAX_JPEG_BYTES) {
		const preferred = clamp(Math.round(preferredQuality), MIN_REENCODE_QUALITY, 95);

		if (preferred !== this.preferredQuality) {
			this.preferredQuality = preferred;
			this.adaptiveQuality = preferred;
		}

		let quality = clamp(this.adaptiveQuality || preferred, MIN_REENCODE_QUALITY, preferred);
		let jpeg = null;

		for (let attempt = 0; attempt < 4; attempt++) {
			jpeg = this.encode(rgb, width, height, quality);

			if (jpeg.length <= targetBytes) {
				const roomy = jpeg.length < targetBytes * 0.7 && quality < preferred;
				this.adaptiveQuality = roomy ? Math.min(preferred, quality + 5) : quality;

				return { jpeg, quality };
			}

			if (quality <= MIN_REENCODE_QUALITY) {
				break;
			}

			quality = Math.max(MIN_REENCODE_QUALITY, quality - (jpeg.length > hardLimit ? 20 : 10));
		}

		this.adaptiveQuality = quality;

		return jpeg && jpeg.length <= hardLimit ? { jpeg, quality } : null;
	}
}

// ---------------------------------------------------------------------------
// Status screens (shown on the panel instead of a blank or frozen display)
// ---------------------------------------------------------------------------

// 5x8 bitmap glyphs (7 rows + descender), one byte per row, bit 4 = leftmost pixel.
// eslint-disable-next-line max-len
const FONT_ASCII_HEX = "000000000000000004040404040004000a0a0000000000000a0a1f0a1f0a0a00040f140e051e040018190204081303000c12140815120d000404000000000000020408080804020008040202020408000004150e150400000004041f0404000000000000000c04080000001f0000000000000000000c0c0000010204081000000e11131519110e00040c040404040e000e11010204081f001f02040201110e0002060a121f0202001f101e0101110e000608101e11110e001f010204080808000e11110e11110e000e11110f01020c00000c0c000c0c0000000c0c000c040800020408100804020000001f001f00000008040201020408000e110102040004000e11010d15150e000e11111f111111001e11111e11111e000e11101010110e001c12111111121c001f10101e10101f001f10101e101010000e11101711110f001111111f111111000e04040404040e000702020202120c0011121418141211001010101010101f00111b15151111110011111915131111000e11111111110e001e11111e101010000e11111115120d001e11111e141211000f10100e01011e001f040404040404001111111111110e0011111111110a04001111111515150a0011110a040a11110011110a04040404001f01020408101f000e08080808080e0000100804020100000e02020202020e00040a1100000000000000000000001f00080400000000000000000e010f110f0010101e1111111e0000000e1010110e0001010f1111110f0000000e111f100e000609081c0808080000000f11110f010e101016191111110004000c0404040e00020006020202120c10101214181412000c04040404040e0000001a1515151500000016191111110000000e1111110e0000001e11111e101000000f11110f0101000016191010100000000f100e011e0008081c08080906000000111111130d0000001111110a04000000111115150a000000110a040a110000001111110f010e00001f0204081f000204040804040200040404040404040008040402040408000000081502000000";
const FONT_EXTRA_CHARS = "ÄÖÜäöüß°×…→";
// eslint-disable-next-line max-len
const FONT_EXTRA_HEX = "110e11111f111100110e111111110e001100111111110e000a000e010f110f000a000e1111110e000a00111111130d000c121214121116000c12120c000000000000110a040a110000000000000015000002011f01020000";

const FONT = (() => {
	const glyphs = new Map();
	const add = (character, hex, index) => {
		const rows = new Uint8Array(8);

		for (let r = 0; r < 8; r++) {
			rows[r] = parseInt(hex.substr(index * 16 + r * 2, 2), 16);
		}

		glyphs.set(character, rows);
	};

	for (let c = 32; c < 127; c++) {
		add(String.fromCharCode(c), FONT_ASCII_HEX, c - 32);
	}

	for (let i = 0; i < FONT_EXTRA_CHARS.length; i++) {
		add(FONT_EXTRA_CHARS[i], FONT_EXTRA_HEX, i);
	}

	return glyphs;
})();

class RgbCanvas {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.data = new Uint8Array(width * height * 3);
	}

	fillRect(x, y, w, h, color) {
		const x0 = clamp(Math.floor(x), 0, this.width);
		const y0 = clamp(Math.floor(y), 0, this.height);
		const x1 = clamp(Math.floor(x + w), 0, this.width);
		const y1 = clamp(Math.floor(y + h), 0, this.height);

		for (let yy = y0; yy < y1; yy++) {
			for (let xx = x0, o = (yy * this.width + x0) * 3; xx < x1; xx++, o += 3) {
				this.data[o] = color[0];
				this.data[o + 1] = color[1];
				this.data[o + 2] = color[2];
			}
		}
	}

	drawText(text, x, y, scale, color) {
		let cursor = x;

		for (const character of text) {
			const glyph = FONT.get(character) || FONT.get("?");

			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 5; col++) {
					if (glyph[row] & (0x10 >> col)) {
						this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
					}
				}
			}

			cursor += 6 * scale;
		}
	}
}

function wrapText(text, maxChars, maxLines) {
	const lines = [];
	let current = "";

	for (const word of String(text).split(/\s+/).filter(Boolean)) {
		let rest = word;

		while (rest.length > maxChars) {
			if (current) {
				lines.push(current);
				current = "";
			}

			lines.push(rest.slice(0, maxChars));
			rest = rest.slice(maxChars);
		}

		if (!current) {
			current = rest;
		} else if (current.length + 1 + rest.length <= maxChars) {
			current += ` ${rest}`;
		} else {
			lines.push(current);
			current = rest;
		}
	}

	if (current) {
		lines.push(current);
	}

	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;

		return kept;
	}

	return lines;
}

const SEVERITY_COLORS = {
	info: [58, 160, 255],
	warning: [255, 176, 32],
	error: [255, 77, 77],
};

const MESSAGES = {
	NO_FACE: {
		severity: "info",
		priority: 0,
		de: {
			title: "Kein LCD-Face aktiv",
			body: "SignalRGB liefert gerade kein Bild für dieses Display. Wähle in SignalRGB unter " +
				"Geräte → Jungle Leopard LCD ein LCD-Face aus der Library aus.",
		},
		en: {
			title: "No LCD face active",
			body: "SignalRGB is not providing an image for this display. In SignalRGB, open " +
				"Devices → Jungle Leopard LCD and pick an LCD face from the library.",
		},
	},
	FACE_INCOMPATIBLE: {
		severity: "warning",
		priority: 1,
		de: {
			title: "Face nicht kompatibel",
			body: "Das gewählte LCD-Face liefert ein Bild, das dieses Display nicht darstellen kann ({detail}). " +
				"Bitte ein anderes Face wählen oder SignalRGB aktualisieren.",
		},
		en: {
			title: "Face not compatible",
			body: "The selected LCD face produces an image this display cannot show ({detail}). " +
				"Please choose another face or update SignalRGB.",
		},
	},
	FRAME_TOO_LARGE: {
		severity: "warning",
		priority: 1,
		de: {
			title: "Bild zu detailreich",
			body: "Das LCD-Face erzeugt selbst bei niedrigster Qualität Bilder über 80 KB, das Limit des Displays. " +
				"Bitte ein ruhigeres Face oder das quadratische Layout wählen.",
		},
		en: {
			title: "Image too detailed",
			body: "Even at the lowest quality the LCD face produces images above the panel's 80 KB limit. " +
				"Please choose a calmer face or the square layout.",
		},
	},
	RAW_UNAVAILABLE: {
		severity: "warning",
		priority: 1,
		de: {
			title: "Layout nicht verfügbar",
			body: "Für Drehung oder das quadratische Layout braucht das Plugin Rohbilder, die diese SignalRGB-Version " +
				"nicht liefert. Bitte 'Full Panel' und 'Landscape' wählen oder die Drehung im LCD-Face nutzen.",
		},
		en: {
			title: "Layout unavailable",
			body: "Rotation and the square layout need raw frames, which this SignalRGB version does not provide. " +
				"Please choose 'Full Panel' and 'Landscape', or use the LCD face's own rotation.",
		},
	},
	RENDER_ERROR: {
		severity: "error",
		priority: 1,
		de: {
			title: "Darstellungsfehler",
			body: "Beim Aufbereiten des LCD-Face ist ein Fehler aufgetreten ({detail}). Das Plugin versucht es automatisch erneut.",
		},
		en: {
			title: "Rendering error",
			body: "An error occurred while preparing the LCD face ({detail}). The plugin keeps retrying automatically.",
		},
	},
	PANEL_MISMATCH: {
		severity: "error",
		priority: 1,
		de: {
			title: "Nicht unterstütztes Display",
			body: "Das USB-Gerät 33C3:7788 meldet {detail}. Dieses Plugin ist für das 960×480-Display " +
				"des Jungle Leopard ausgelegt und sendet daher keine Bilder.",
		},
		en: {
			title: "Unsupported display",
			body: "USB device 33C3:7788 reports {detail}. This plugin is built for the Jungle Leopard 960×480 " +
				"display and therefore sends no images.",
		},
	},
	LINK_LOST: {
		severity: "error",
		priority: 1,
		de: {
			title: "Verbindung zum Display unterbrochen",
			body: "Das Senden an das Display ist fehlgeschlagen ({detail}). Das Plugin verbindet sich automatisch neu. " +
				"Wurde das Display abgesteckt, oder hat ein anderes Programm den COM-Port übernommen?",
		},
		en: {
			title: "Lost connection to the display",
			body: "Sending to the display failed ({detail}). The plugin reconnects automatically. " +
				"Was the display unplugged, or did another program take over its COM port?",
		},
	},
	PORT_BUSY: {
		severity: "error",
		priority: 1,
		de: {
			title: "COM-Port des Displays belegt",
			body: "SignalRGB kann {detail} nicht öffnen, ein anderes Programm benutzt ihn. Bitte die Hersteller-App " +
				"ganz beenden (auch im Infobereich) und die alte 'Jungle Leopard LCD Bridge' entfernen, falls " +
				"installiert. Neuer Versuch alle paar Sekunden.",
		},
		en: {
			title: "Display COM port in use",
			body: "SignalRGB cannot open {detail}, another program is using it. Please quit the vendor app " +
				"completely (check the system tray) and remove the old 'Jungle Leopard LCD Bridge' if it is " +
				"installed. Retrying every few seconds.",
		},
	},
	SERIAL_UNAVAILABLE: {
		severity: "error",
		priority: 1,
		de: {
			title: "SignalRGB-Update nötig",
			body: "Das Display ist über einen COM-Port angeschlossen, und diese SignalRGB-Version gibt Plugins darauf " +
				"noch keinen Zugriff. Bitte SignalRGB aktualisieren.",
		},
		en: {
			title: "SignalRGB update needed",
			body: "The display is connected through a COM port, and this SignalRGB version does not give plugins " +
				"access to COM ports yet. Please update SignalRGB.",
		},
	},
	STARTUP_REPORT: {
		severity: "info",
		priority: 0,
		de: { title: "Jungle Leopard LCD - Diagnose", body: "{detail}" },
		en: { title: "Jungle Leopard LCD - diagnostics", body: "{detail}" },
	},
};

const REASONS = {
	"progressive": { de: "progressives JPEG", en: "progressive JPEG" },
	"unsupported-coding": { de: "nicht unterstützte JPEG-Kodierung", en: "unsupported JPEG coding" },
	"color-format": { de: "Graustufen- oder 12-Bit-Bild", en: "grayscale or 12-bit image" },
	"subsampling": { de: "Farbunterabtastung ist nicht 4:2:0", en: "chroma subsampling is not 4:2:0" },
	"restart-markers": { de: "JPEG mit Restart-Markern", en: "JPEG with restart markers" },
	"size": { de: "Bildgröße passt nicht zu 960×480", en: "image size does not match 960×480" },
	"too-large": { de: "Bild größer als 80 KB", en: "image larger than 80 KB" },
	"not-jpeg": { de: "kein gültiges JPEG", en: "not a valid JPEG" },
	"corrupt": { de: "beschädigtes JPEG", en: "corrupt JPEG" },
	"truncated": { de: "unvollständiges Bild", en: "truncated image" },
	"no-frame-header": { de: "JPEG ohne Bildkopf", en: "JPEG without frame header" },
	"no-scan": { de: "JPEG ohne Bilddaten", en: "JPEG without image data" },
	"bmp-signature": { de: "Rohbild nicht verfügbar", en: "raw image not available" },
	"bmp-format": { de: "Rohbildformat nicht unterstützt", en: "raw image format not supported" },
	"bmp-size": { de: "ungültige Rohbildgröße", en: "invalid raw image size" },
	"bmp-truncated": { de: "unvollständiges Rohbild", en: "truncated raw image" },
	"raw-unavailable": { de: "SignalRGB liefert kein Rohbild", en: "SignalRGB provides no raw image" },
};

function describeReason(reason, language) {
	const entry = REASONS[reason];

	return entry ? entry[language] : String(reason || "?");
}

function localizedMessage(key, language, detail) {
	const message = MESSAGES[key];
	const text = message[language] || message.en;
	const fill = (template) => template.replace("{detail}", detail || "?");

	return { title: fill(text.title), body: fill(text.body), severity: message.severity, priority: message.priority };
}

function renderStatusScreen(key, language, detail) {
	const message = localizedMessage(key, language, detail);
	const canvas = new RgbCanvas(PANEL_WIDTH, PANEL_HEIGHT);
	const left = 64;
	const usable = PANEL_WIDTH - left - 48;

	canvas.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, [14, 17, 22]);
	canvas.fillRect(0, 0, 16, PANEL_HEIGHT, SEVERITY_COLORS[message.severity]);
	canvas.drawText("JUNGLE LEOPARD LCD - SIGNALRGB", left, 40, 2, [138, 147, 163]);

	let y = 92;

	for (const line of wrapText(message.title, Math.floor(usable / 30), 2)) {
		canvas.drawText(line, left, y, 5, [255, 255, 255]);
		y += 52;
	}

	y += 20;

	const bodyLines = Math.max(1, Math.floor((426 - y) / 34));

	for (const line of wrapText(message.body, Math.floor(usable / 18), bodyLines)) {
		canvas.drawText(line, left, y, 3, [201, 209, 220]);
		y += 34;
	}

	canvas.drawText(`Code: ${key}   Plugin ${PLUGIN_VERSION}`, left, 436, 2, [107, 117, 133]);

	return canvas.data;
}

// ---------------------------------------------------------------------------
// SignalRGB notifications
// ---------------------------------------------------------------------------

class Alerts {
	constructor() {
		this.active = new Map();
	}

	raise(slot, title, body, priority) {
		const current = this.active.get(slot);

		if (current && current.title === title && current.body === body) {
			return;
		}

		this.clear(slot);
		log(`${title}: ${body}`);

		let id = null;

		try {
			id = device.notify(title, body, priority);
		} catch (e) {
			id = null;
		}

		this.active.set(slot, { id, title, body });
	}

	raiseMessage(slot, key, language, detail) {
		const message = localizedMessage(key, language, detail);
		this.raise(slot, message.title, message.body, message.priority);
	}

	clear(slot) {
		const current = this.active.get(slot);

		if (!current) {
			return;
		}

		this.active.delete(slot);

		try {
			if (current.id !== null && current.id !== undefined) {
				device.denotify(current.id);
			}
		} catch (e) {
			// Nothing to do: the alert may already be gone.
		}
	}

	clearAll() {
		for (const slot of Array.from(this.active.keys())) {
			this.clear(slot);
		}
	}
}

// ---------------------------------------------------------------------------
// Frame pipeline: SignalRGB LCD face -> panel-ready JPEG
// ---------------------------------------------------------------------------

class FramePipeline {
	constructor(encoder) {
		this.encoder = encoder;
		this.composeBuffer = new Uint8Array(PANEL_WIDTH * PANEL_HEIGHT * 3);
		this.statusCache = new Map();
		this.reset();
	}

	reset() {
		this.mode = "jpeg";
		this.rawSince = 0;
		this.lastJpegReason = "";
		this.oversizeStreak = 0;
		this.emptySince = 0;
		this.mapKey = "";
		this.map = null;
		this.lastRaw = null;
		this.rgbFormat = true;
	}

	/** A black panel frame, repeated while the display is switched off. */
	blackFrame() {
		if (!this.black) {
			this.black = this.encoder.encode(new Uint8Array(PANEL_WIDTH * PANEL_HEIGHT * 3), PANEL_WIDTH, PANEL_HEIGHT, STATUS_QUALITY);
		}

		return this.black;
	}

	switchToRaw(reason, now) {
		if (this.mode !== "raw") {
			this.rawSince = now;

			if (reason !== this.loggedRawReason) {
				log(`Face frames are converted on the host (${reason}).`);
				this.loggedRawReason = reason;
			}
		}

		this.mode = "raw";
		this.lastJpegReason = reason;
	}

	statusFrame(key, detail, settings) {
		const cacheKey = `${key}|${settings.language}|${detail}`;
		let bytes = this.statusCache.get(cacheKey);

		if (!bytes) {
			const rgb = renderStatusScreen(key, settings.language, detail);
			bytes = this.encoder.encode(rgb, PANEL_WIDTH, PANEL_HEIGHT, STATUS_QUALITY);

			if (bytes.length > TARGET_JPEG_BYTES) {
				bytes = this.encoder.encode(rgb, PANEL_WIDTH, PANEL_HEIGHT, MIN_REENCODE_QUALITY);
			}

			if (this.statusCache.size > 8) {
				this.statusCache.clear();
			}

			this.statusCache.set(cacheKey, bytes);
		}

		return { bytes, kind: "status", problem: { key, detail } };
	}

	noFrame(settings, now) {
		if (!this.emptySince) {
			this.emptySince = now;
		}

		return now - this.emptySince < NO_FRAME_GRACE_MS ? null : this.statusFrame("NO_FACE", "", settings);
	}

	/** Returns {bytes, kind, problem} to send, or null to send nothing this tick. */
	next(settings, now) {
		if (needsHostTransform(settings)) {
			this.mode = "raw";
			this.lastJpegReason = "";
		} else if (this.mode === "raw" && now - this.rawSince >= RAW_REPROBE_MS) {
			// The user may have picked another face meanwhile: try the zero-cost pass-through again.
			this.mode = "jpeg";
			this.oversizeStreak = 0;
		}

		if (this.mode === "jpeg") {
			const jpeg = LCD.getFrame({ format: "JPEG" });

			if (!isByteArray(jpeg) || jpeg.length === 0) {
				return this.noFrame(settings, now);
			}

			this.emptySince = 0;

			const reason = panelIncompatibility(inspectJpeg(jpeg), jpeg.length);

			if (!reason) {
				this.oversizeStreak = 0;
				this.lastJpegReason = "";

				return { bytes: jpeg, kind: "face", problem: null };
			}

			if (reason !== "too-large" || ++this.oversizeStreak >= OVERSIZE_STREAK_LIMIT) {
				this.switchToRaw(reason, now);
			}

			this.lastJpegReason = reason;
		}

		return this.rawFrame(settings, now);
	}

	/** The face as raw pixels: plain RGB where SignalRGB offers it (2.5+), otherwise a BMP. Null if neither. */
	rawSource(settings) {
		if (this.rgbFormat) {
			const [width, height] = viewportFor(settings);
			const rgb = LCD.getFrame({ format: "RGB" });

			if (isByteArray(rgb) && rgb.length === width * height * 3) {
				return { kind: "rgb", bytes: rgb, width, height };
			}
		}

		const bmp = LCD.getFrame({ format: "BMP" });

		if (!isByteArray(bmp) || bmp.length === 0) {
			return null;
		}

		// BMP works where RGB did not: stop asking for RGB until the next reset.
		this.rgbFormat = false;

		return { kind: "bmp", bytes: bmp };
	}

	rawFrame(settings, now) {
		const source = this.rawSource(settings);

		if (!source) {
			return this.rawUnavailable(settings, now);
		}

		this.emptySince = 0;

		const signature = `${source.kind}|${hashBytes(source.bytes)}|${settings.rotation}|${settings.fill.join()}|${settings.quality}`;

		if (this.lastRaw && this.lastRaw.signature === signature) {
			return this.lastRaw.frame;
		}

		let image;

		try {
			image = source.kind === "rgb" ? { width: source.width, height: source.height, rgb: source.bytes } : decodeBmp(source.bytes);
		} catch (e) {
			const reason = this.lastJpegReason || e.code || "bmp-format";

			return this.statusFrame("FACE_INCOMPATIBLE", describeReason(reason, settings.language), settings);
		}

		const rgb = this.compose(image, settings);
		const result = this.encoder.encodeWithinBudget(rgb, PANEL_WIDTH, PANEL_HEIGHT, settings.quality);

		if (!result) {
			return this.statusFrame("FRAME_TOO_LARGE", "", settings);
		}

		const frame = { bytes: result.jpeg, kind: "face", problem: null };
		this.lastRaw = { signature, frame };

		return frame;
	}

	/** No raw frame: either no face is active at all, or this SignalRGB build cannot hand out raw frames. */
	rawUnavailable(settings, now) {
		const jpeg = LCD.getFrame({ format: "JPEG" });

		if (!isByteArray(jpeg) || jpeg.length === 0) {
			return this.noFrame(settings, now);
		}

		this.emptySince = 0;

		if (this.lastJpegReason) {
			return this.statusFrame("FACE_INCOMPATIBLE", describeReason(this.lastJpegReason, settings.language), settings);
		}

		return this.statusFrame("RAW_UNAVAILABLE", "", settings);
	}

	compose(image, settings) {
		if (image.width === PANEL_WIDTH && image.height === PANEL_HEIGHT && settings.rotation === 0) {
			return image.rgb;
		}

		const key = `${image.width}x${image.height}@${settings.rotation}`;

		if (key !== this.mapKey) {
			this.map = buildPixelMap(image.width, image.height, settings.rotation);
			this.mapKey = key;
		}

		return composeFrame(image, this.map, settings.fill, this.composeBuffer);
	}
}

// ---------------------------------------------------------------------------
// Plugin state and lifecycle
// ---------------------------------------------------------------------------

/** SignalRGB exposes user properties as globals named after the property; undefined until it sets them. */
function readUserProperties() {
	return {
		displayEnabled: typeof displayEnabled === "undefined" ? undefined : displayEnabled,
		faceLayout: typeof faceLayout === "undefined" ? undefined : faceLayout,
		mountOrientation: typeof mountOrientation === "undefined" ? undefined : mountOrientation,
		sideFillColor: typeof sideFillColor === "undefined" ? undefined : sideFillColor,
		lcdBrightness: typeof lcdBrightness === "undefined" ? undefined : lcdBrightness,
		maxFps: typeof maxFps === "undefined" ? undefined : maxFps,
		reencodeQuality: typeof reencodeQuality === "undefined" ? undefined : reencodeQuality,
		messageLanguage: typeof messageLanguage === "undefined" ? undefined : messageLanguage,
		shutdownBehavior: typeof shutdownBehavior === "undefined" ? undefined : shutdownBehavior,
		startupReport: typeof startupReport === "undefined" ? undefined : startupReport,
	};
}

function readSettings() {
	const p = readUserProperties();
	const knownOrientation = Object.prototype.hasOwnProperty.call(ORIENTATION_DEGREES, p.mountOrientation);

	return {
		displayOn: p.displayEnabled !== false && p.displayEnabled !== "false",
		layout: p.faceLayout === LAYOUT_SQUARE ? LAYOUT_SQUARE : LAYOUT_FULL,
		rotation: knownOrientation ? ORIENTATION_DEGREES[p.mountOrientation] : 0,
		fill: hexToRgb(p.sideFillColor),
		brightness: clamp(toNumber(p.lcdBrightness, 100), 0, 100),
		maxFps: clamp(toNumber(p.maxFps, 30), 5, 30),
		quality: clamp(toNumber(p.reencodeQuality, 85), 40, 95),
		language: p.messageLanguage === "English" ? "en" : "de",
		shutdown: p.shutdownBehavior === SHUTDOWN_BACKLIGHT_OFF ? SHUTDOWN_BACKLIGHT_OFF : SHUTDOWN_RELEASE,
		report: p.startupReport !== false && p.startupReport !== "false",
	};
}

const link = new SerialLink();
const encoder = new JpegEncoder();
const pipeline = new FramePipeline(encoder);
const alerts = new Alerts();
let state = createState();

function createState() {
	return {
		active: false,
		linkOk: false,
		nextRecoveryAt: 0,
		panelInfo: null,
		settings: readSettings(),
		viewport: [0, 0],
		lastProducedAt: 0,
		lastSendAt: 0,
		lastHash: 0,
		framesSent: 0,
		lastPipelineError: "",
		lastReconnectError: "",
		probed: false,
		reportedOk: false,
	};
}

function errorText(e) {
	return e && e.message ? e.message : String(e);
}

function configureViewport() {
	const [width, height] = viewportFor(state.settings);
	LCD.initialize({ width, height });
	state.viewport = [width, height];
	pipeline.reset();
	log(`LCD face viewport ${width}x${height} (${state.settings.layout}, rotation ${state.settings.rotation}°).`);
}

/** Backlight level actually sent to the panel: 0 while the display is switched off in SignalRGB. */
function backlightLevel(settings) {
	return settings.displayOn ? settings.brightness : 0;
}

/** Picks up parameter changes; called from Render and from the on<Property>Changed callbacks. */
function applySettings() {
	const previous = state.settings;
	const next = readSettings();
	state.settings = next;

	if (!state.active) {
		return;
	}

	if (previous.layout !== next.layout || previous.rotation !== next.rotation) {
		configureViewport();
	}

	if (backlightLevel(previous) !== backlightLevel(next) && state.linkOk) {
		guardedLink(() => link.setBacklight(backlightLevel(next)));
	}

	if (previous.displayOn !== next.displayOn) {
		log(`Display switched ${next.displayOn ? "on" : "off"}.`);
		state.lastHash = 0;
		state.lastSendAt = 0;
		alerts.clear("frame");
	}

	if (previous.language !== next.language) {
		alerts.clear("frame");
	}

	if (previous.fill.join() !== next.fill.join()) {
		pipeline.mapKey = "";
	}
}

function guardedLink(action) {
	try {
		action();

		return true;
	} catch (e) {
		onLinkError(e, Date.now());

		return false;
	}
}

/** Explains a transport failure. The port is closed, so the next recovery attempt opens it afresh. */
function onLinkError(e, now) {
	state.linkOk = false;
	state.nextRecoveryAt = now + RECOVERY_INTERVAL_MS;
	link.disconnect();

	const language = state.settings.language;
	const code = e && e.code;

	if (code === "no-serial") {
		alerts.raiseMessage("link", "SERIAL_UNAVAILABLE", language, "");
	} else if (code === "port-busy") {
		alerts.raiseMessage("link", "PORT_BUSY", language, link.portLabel());
	} else {
		alerts.raiseMessage("link", "LINK_LOST", language, errorText(e));
	}
}

function enterLive() {
	link.setBacklight(backlightLevel(state.settings));
	link.keepAlive(Date.now());
	device.pause(100);
	state.linkOk = true;
	state.lastHash = 0;
	state.lastSendAt = 0;
}

/**
 * Opens the COM port if needed, resynchronizes the panel's parser, identifies the panel (once) and enters
 * live mode. Returns false, with the port closed again, if a different display answers.
 */
function connectPanel() {
	link.open();
	link.flush();

	if (!state.probed) {
		const { reply, note } = link.requestInfo(INFO_TIMEOUT_MS);
		link.probeNote = note;
		state.probed = true;

		const verdict = identifyPanel(reply);

		if (verdict.status === "mismatch") {
			alerts.raiseMessage("panel", "PANEL_MISMATCH", state.settings.language, verdict.reason);
			link.disconnect();

			return false;
		}
	}

	enterLive();

	return true;
}

function tryRecover(now) {
	if (now < state.nextRecoveryAt) {
		return;
	}

	state.nextRecoveryAt = now + RECOVERY_INTERVAL_MS;

	try {
		if (!connectPanel()) {
			state.active = false;
			alerts.clear("link");
			reportStartup("");

			return;
		}

		alerts.clear("link");
		log("Connection to the panel restored.");

		// The startup diagnosis showed the failure: replace it with the working state.
		if (!state.reportedOk) {
			reportStartup("");
		}
	} catch (e) {
		link.disconnect();

		// Retried every few seconds: only log when the reason changes.
		if (errorText(e) !== state.lastReconnectError) {
			log(`Reconnect failed: ${errorText(e)}`);
			state.lastReconnectError = errorText(e);
		}
	}
}

function identifyPanel(reply) {
	state.panelInfo = reply ? parseDeviceInfo(reply.text) : null;

	const verdict = assessPanel(state.panelInfo);

	if (state.panelInfo) {
		log(`Panel info: ${state.panelInfo.raw}`);
	}

	log(`Panel check: ${verdict.status} (${verdict.reason}), ${link.infoBytesReceived} bytes received.`);

	return verdict;
}

/** One line summarizing how the connection to the panel went on this machine. */
function diagnosisText(failure) {
	const info = state.panelInfo;
	const version = info && !Number.isNaN(info.version) ? `, FW ${info.version}` : "";
	const reply = info ? `${link.infoBytesReceived} B, ${info.model || "unknown model"}${version}` : `none (${link.probeNote})`;
	const parts = [
		`Plugin ${PLUGIN_VERSION}`,
		`Serial: ${SerialLink.available() ? "yes" : "missing"}`,
		`Port: ${link.portName || "?"} (${link.portInfo})`,
		`Connect: ${link.connectNote}`,
		`Write: ${link.firstWriteResult}`,
		`Reply: ${reply}`,
	];

	if (failure) {
		parts.push(`Error: ${failure}`);
	}

	return parts.join(" | ");
}

/** Logs the startup diagnosis and, unless disabled, shows it as a SignalRGB notification. */
function reportStartup(failure) {
	const text = diagnosisText(failure);
	log(`Diagnosis: ${text}`);
	state.reportedOk = !failure;

	if (state.settings.report) {
		alerts.raiseMessage("report", "STARTUP_REPORT", state.settings.language, text);
	}
}

export function Initialize() {
	state = createState();
	alerts.clearAll();
	link.resetDiagnostics();
	log(`Plugin ${PLUGIN_VERSION} starting.`);

	try {
		if (!connectPanel()) {
			reportStartup("");

			return;
		}

		reportStartup("");
	} catch (e) {
		log(`Could not start the panel: ${errorText(e)}`);
		reportStartup(errorText(e));
		onLinkError(e, Date.now());
	}

	state.active = true;
	configureViewport();
}

function updateFrameAlerts(frame) {
	if (!frame) {
		return;
	}

	if (!frame.problem) {
		alerts.clear("frame");

		return;
	}

	alerts.raiseMessage("frame", frame.problem.key, state.settings.language, frame.problem.detail);
}

function produceFrame(now) {
	try {
		return pipeline.next(state.settings, now);
	} catch (e) {
		if (errorText(e) !== state.lastPipelineError) {
			log(`Frame pipeline error: ${errorText(e)}`);
			state.lastPipelineError = errorText(e);
		}

		return pipeline.statusFrame("RENDER_ERROR", errorText(e), state.settings);
	}
}

/**
 * Display switched off in SignalRGB: the backlight is at 0 and a black frame is repeated, so the panel
 * stays in live mode and its own animation does not come back.
 */
function holdDark(now) {
	if (now - state.lastSendAt < DISPLAY_OFF_REFRESH_MS) {
		return;
	}

	if (guardedLink(() => link.sendJpeg(pipeline.blackFrame()))) {
		state.lastSendAt = now;
	}
}

export function Render() {
	if (!state.active) {
		return;
	}

	applySettings();

	const now = Date.now();

	if (!state.linkOk) {
		tryRecover(now);

		return;
	}

	if (now - link.lastKeepAlive >= KEEPALIVE_INTERVAL_MS && !guardedLink(() => link.keepAlive(now))) {
		return;
	}

	if (!state.settings.displayOn) {
		holdDark(now);

		return;
	}

	if (now - state.lastProducedAt < 1000 / state.settings.maxFps) {
		return;
	}

	state.lastProducedAt = now;

	const frame = produceFrame(now);
	updateFrameAlerts(frame);

	if (!frame) {
		return;
	}

	const hash = hashBytes(frame.bytes);

	if (hash === state.lastHash && now - state.lastSendAt < STILL_REFRESH_MS) {
		return;
	}

	if (guardedLink(() => link.sendJpeg(frame.bytes))) {
		state.lastHash = hash;
		state.lastSendAt = now;
		state.framesSent++;
	}
}

export function Shutdown(SystemSuspending) {
	const wasActive = state.active;
	state.active = false;
	alerts.clearAll();

	if (!wasActive || !state.linkOk) {
		link.disconnect();

		return;
	}

	const settings = readSettings();
	const darken = SystemSuspending || settings.shutdown === SHUTDOWN_BACKLIGHT_OFF;
	log(`Shutdown (${SystemSuspending ? "system suspend" : "SignalRGB"}): ${darken ? "backlight off" : "release to panel"}.`);

	try {
		if (darken) {
			link.setBacklight(0);
		}

		link.flushEndOfImage();

		// Close (0x21) exists from firmware 3.1 on; older panels simply leave live mode after ~1.5 s.
		if (state.panelInfo && state.panelInfo.version >= 3.1) {
			link.release();
		}

		device.pause(50);
	} catch (e) {
		log(`Shutdown write failed: ${errorText(e)}`);
	}

	// Free the COM port, so the vendor app can take the panel over again.
	link.disconnect();
}

export function ondisplayEnabledChanged() { applySettings(); }
export function onfaceLayoutChanged() { applySettings(); }
export function onmountOrientationChanged() { applySettings(); }
export function onsideFillColorChanged() { applySettings(); }
export function onlcdBrightnessChanged() { applySettings(); }
export function onmaxFpsChanged() { applySettings(); }
export function onreencodeQualityChanged() { applySettings(); }
export function onmessageLanguageChanged() { applySettings(); }
export function onshutdownBehaviorChanged() { applySettings(); }
export function onstartupReportChanged() { applySettings(); }

/** Internal building blocks, exported for the test suite only. SignalRGB ignores this export. */
export const _internals = Object.freeze({
	PANEL_WIDTH, PANEL_HEIGHT, MAX_JPEG_BYTES, TARGET_JPEG_BYTES, KEEPALIVE_INTERVAL_MS, STILL_REFRESH_MS,
	NO_FRAME_GRACE_MS, DISPLAY_OFF_REFRESH_MS, SERIAL, CMD, LAYOUT_FULL, LAYOUT_SQUARE, ORIENTATION_DEGREES,
	sum16, buildControlFrame, buildImageEnvelope, avoidMagicCollision, extractReply, toBytes, SerialLink,
	parseDeviceInfo, assessPanel, inspectJpeg, panelIncompatibility, decodeBmp,
	viewportFor, buildPixelMap, composeFrame, JpegEncoder, FONT, wrapText, renderStatusScreen,
	localizedMessage, describeReason, MESSAGES, REASONS,
	getState: () => state,
	getLink: () => link,
});

// eslint-disable-next-line max-len
const DEVICE_IMAGE_PNG_BASE64 = "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";
