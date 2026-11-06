// Lets Node resolve the SignalRGB-provided "@SignalRGB/lcd" module to a test double.
import { register } from "node:module";

register("./signalrgb-loader.mjs", import.meta.url);
