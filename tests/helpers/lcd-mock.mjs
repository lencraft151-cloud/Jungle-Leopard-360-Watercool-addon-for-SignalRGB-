// Test double for SignalRGB's built-in "@SignalRGB/lcd" module (see types/lcd.d.ts in signal-plugins).
const LCD = {
	initializeCalls: [],
	frameRequests: [],
	frameProvider: null,

	initialize(options) {
		this.initializeCalls.push({ ...options });
	},

	getFrame(options) {
		this.frameRequests.push(options.format);

		return this.frameProvider ? this.frameProvider(options) : [];
	},

	reset() {
		this.initializeCalls = [];
		this.frameRequests = [];
		this.frameProvider = null;
	},
};

export default LCD;
