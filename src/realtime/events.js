/** The server's one event bus (see event-bus.js): features publish here, the WebSocket channels deliver. */
import { createEventBus } from "./event-bus.js";

export const bus = createEventBus();

/** The admin's waiting list or approved list of `kind` ("device" or "account") changed: open admin pages read it again. Names nobody. */
export const approvalsChanged = (kind) => bus.tell({ topic: "approvals", audience: { admin: true }, payload: { kind } });
