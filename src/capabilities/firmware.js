/**
 * Firmware releases followed from a GitHub repository (firmware/service.js): what the list holds,
 * whether its source answered, and a check of the list now. The source itself is the firmwareRepo
 * setting, which only the admin page changes (TOKEN_LOCKED). The console's own list (/api/firmware)
 * is opted out in opt-out.js: it is this status in the console's shape. The server keeps no zip.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import { firmware } from "../routes/firmware.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

const VERSION = obj({
  version: str("three numbers, as the release tag"),
  released: str("the release date, YYYY-MM-DD, or empty"),
  available: bool("the source lists it now, so a console may download it from there"),
  reason: nullable(oneOf(["upstream_gone"], "why it is not available")),
  size: int("the zip's size in bytes at the source"),
  url: str("the zip's own address at the source"),
});

const STATUS = obj({
  source: nullable(str("the owner/name followed, null when none is set")),
  enabled: bool("a source is set, so consoles see the firmware list"),
  hours: int("hours between checks of the list"),
  reachable: bool("the source answered at the last check"),
  checked_at: nullable(int("epoch ms of the last check")),
  error: nullable(obj({ kind: str(), message: str() }, { description: "why the last check kept the list" })),
  next_check: nullable(int("epoch ms of the next check")),
  checking: bool("a check is running"),
  versions: arr(VERSION, "newest first"),
});

export const firmwareCapabilities = [
  defineCapability({
    id: "firmware_status",
    area: "admin",
    title: "Firmware list status",
    description: "The firmware releases followed: the source, whether it answered at the last check, and each version with whether the source still offers it. The server keeps no zip; consoles download from the source.",
    input: { type: "object", properties: {} },
    output: STATUS,
    safety: "read",
    http: { method: "GET", path: "/admin/api/firmware" },
    handler: async () => firmware.status(),
  }),
  defineCapability({
    id: "firmware_refresh",
    area: "admin",
    title: "Check the firmware list now",
    description: "Reads the firmware release list from its source again now, in the background. A failed check keeps the list. Follow it with firmware_status.",
    input: { type: "object", properties: {} },
    output: obj({ started: bool("false when a check was already running") }),
    preview: async () => {
      const s = firmware.status();
      return { source: s.source, checked_at: s.checked_at, changes: s.enabled ? "Will ask the source for its release list once. The list only grows; nothing is deleted." : "No source is set, so nothing would be checked." };
    },
    previewOutput: obj({ source: nullable(str()), checked_at: nullable(int()), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/firmware/refresh" },
    handler: async () => {
      if (!firmware.enabled()) throw fail(409, "No firmware source is set; the admin page sets firmwareRepo");
      return { started: firmware.refreshNow() };
    },
  }),
];
