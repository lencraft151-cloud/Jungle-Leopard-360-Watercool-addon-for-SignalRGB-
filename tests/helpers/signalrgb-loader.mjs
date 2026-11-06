const LCD_MOCK = new URL("./lcd-mock.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "@SignalRGB/lcd") {
		return { url: LCD_MOCK, shortCircuit: true };
	}

	return nextResolve(specifier, context);
}
