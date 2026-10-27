/** The server's one event bus (see event-bus.js): features publish here, the WebSocket channels deliver. */
import { createEventBus } from "./event-bus.js";

export const bus = createEventBus();
