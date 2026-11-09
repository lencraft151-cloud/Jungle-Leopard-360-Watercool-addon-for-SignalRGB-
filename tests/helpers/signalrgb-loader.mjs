// Resolves the modules SignalRGB provides to plugins ("@SignalRGB/lcd", "@SignalRGB/serial") to test doubles.
const MOCKS = {
	"@SignalRGB/lcd": new URL("./lcd-mock.mjs", import.meta.url).href,
	"@SignalRGB/serial": new URL("./serial-mock.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
	if (Object.prototype.hasOwnProperty.call(MOCKS, specifier)) {
		return { url: MOCKS[specifier], shortCircuit: true };
	}

	return nextResolve(specifier, context);
}
