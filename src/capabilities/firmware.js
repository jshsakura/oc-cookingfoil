/**
 * Firmware releases followed from a GitHub repository (firmware/service.js): what the list holds,
 * whether its source answered, and a check of the list now. The source itself is the firmwareRepo
 * setting, which only the admin page changes (TOKEN_LOCKED). The console's own list and download
 * (/api/firmware) are opted out in opt-out.js: one is this status in the console's shape, the other a binary.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import { firmware } from "../routes/firmware.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

const VERSION = obj({
  version: str("three numbers, as the release tag"),
  upstream: bool("the source lists it now"),
  cached: bool("the server holds its checked zip"),
  available: bool("a console may download it"),
  reason: nullable(oneOf(["upstream_gone", "bad_archive"], "why it is not available")),
  size: int("the zip's size in bytes"),
  files: int(".nca files in the zip, 0 while unread"),
  problem: str("what the bad zip failed"),
}, { optional: ["problem"] });

const STATUS = obj({
  source: nullable(str("the owner/name followed, null when none is set")),
  enabled: bool("a source is set, so consoles see the firmware list"),
  keep: oneOf(["latest", "all"], "latest fetches the newest zip ahead, all every one"),
  hours: int("hours between checks of the list"),
  reachable: bool("the source answered at the last check"),
  checked_at: nullable(int("epoch ms of the last check")),
  error: nullable(obj({ kind: str(), message: str() }, { description: "why the last check kept the list" })),
  next_check: nullable(int("epoch ms of the next check")),
  checking: bool("a check is running"),
  fetching: nullable(obj({ version: str(), bytes: int(), size: int() })),
  queued: arr(str(), "versions waiting to be fetched"),
  failed: arr({ type: "object" }, "fetches that went wrong lately: version, at, kind, message"),
  cache: obj({ count: int(), bytes: int() }),
  versions: arr(VERSION, "newest first"),
});

export const firmwareCapabilities = [
  defineCapability({
    id: "firmware_status",
    area: "admin",
    title: "Firmware list status",
    description: "The firmware releases followed: the source, whether it answered at the last check, and each version with whether it is cached or available.",
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
