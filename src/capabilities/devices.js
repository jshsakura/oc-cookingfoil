/**
 * Consoles: who waits to be approved and who is approved, and the four things done to one.
 * The admin routes refuse automation tokens (they hand out access), so these are served by MCP
 * alone (mcp: true), behind the preview and confirm='approve'. A console is named by its 8-character
 * code, the one on its screen; its full key never leaves the server.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import * as store from "../security/store.js";
import { deviceCode, normalizeDeviceCode } from "../security/pairing-link.js";
import { approveWaitingDevice } from "../security/pairing-approve.js";
import { accountFull } from "../security/device-limit.js";
import { tokenApprover } from "../security/admin-actor.js";
import * as enrollTokens from "../security/enroll-tokens.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The console this code names, among the waiting and the approved. */
function findDevice(raw) {
  const code = normalizeDeviceCode(raw);
  if (!code) throw fail(400, "device is the 8-character code shown on the console, such as 3F9A01BC; find it with device_list");
  const { approved, pending } = store.devicesSnapshot();
  const row = approved.find((d) => deviceCode(d.deviceKey) === code);
  if (row) return { state: "approved", key: row.deviceKey, row };
  const wait = pending.find((d) => deviceCode(d.deviceKey) === code);
  if (wait) return { state: "pending", key: wait.deviceKey, row: wait };
  throw fail(404, `no console with code ${code}; device_list shows the waiting and approved ones`);
}

const approver = (ctx) => tokenApprover(ctx.token?.owner);

const APPROVED = obj({
  code: str("8-character code, the device argument of device_set"),
  label: str("name shown on the admin page"),
  admin: bool("may change item settings from the console"),
  addedBy: nullable(str("account that approved it")),
  addedAt: nullable(int("epoch ms")),
  lastSeenAt: nullable(int("epoch ms")),
});
const WAITING = obj({
  code: str("8-character code, the device argument of device_set"),
  name: nullable(str("the nickname the console sent")),
  message: nullable(str("the note it sent")),
  firstSeenAt: nullable(int("epoch ms")),
  lastSeenAt: nullable(int("epoch ms")),
});

const DOWNLOAD = obj({
  id: str("8-hex id, the device argument of device_set with op cancel_download"),
  owner: str("account that made the download"),
  expiresAt: int("epoch ms"),
}, { description: "a client download waiting to be used" });

const OPS = {
  approve: "approve a waiting console, or give an approved one a new key",
  rename: "change the name (label)",
  revoke: "remove the console; it must pair again",
  cancel_download: "cancel a waiting client download (its id, from device_list)",
  admin: "let it change item settings (on: true), or only read (on: false)",
};

function check(input) {
  if (!Object.hasOwn(OPS, input.op)) throw fail(400, `op is one of ${Object.keys(OPS).join(", ")}`);
  if (input.op === "rename" && typeof input.label !== "string") throw fail(400, "rename needs label");
  if (input.op === "admin" && typeof input.on !== "boolean") throw fail(400, "admin needs on: true or false");
  if (input.op === "cancel_download") {
    const row = enrollTokens.list().find((t) => t.id === String(input.device) && t.state === "waiting");
    if (!row) throw fail(404, `no waiting download ${input.device}; device_list shows them`);
    return { state: "download", key: null, row };
  }
  const found = findDevice(input.device);
  if (found.state === "pending" && input.op !== "approve" && input.op !== "revoke") throw fail(409, "only an approved console can be renamed or made an admin device; approve it first");
  return found;
}

const name = (row) => row.label || row.name || row.message || "";

export const devicesCapabilities = [
  defineCapability({
    id: "device_list",
    area: "admin",
    title: "List consoles",
    description: "Lists the consoles waiting for approval and the approved ones, each with the 8-character code device_set takes. Read before approving or removing one.",
    input: { type: "object", properties: {} },
    output: obj({ waiting: arr(WAITING), approved: arr(APPROVED), downloads: arr(DOWNLOAD) }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/devices" },
    handler: async () => {
      const { approved, pending } = store.devicesSnapshot();
      return {
        waiting: pending.map((d) => ({ code: deviceCode(d.deviceKey), name: d.name ?? null, message: d.message ?? null, firstSeenAt: d.firstSeenAt ?? null, lastSeenAt: d.lastSeenAt ?? null })),
        downloads: enrollTokens.list().filter((t) => t.state === "waiting").map((t) => ({ id: t.id, owner: t.owner, expiresAt: t.expiresAt })),
        approved: approved.map((d) => ({ code: deviceCode(d.deviceKey), label: d.label, admin: d.admin, addedBy: d.addedBy, addedAt: d.addedAt, lastSeenAt: d.lastSeenAt ?? null })),
      };
    },
  }),
  defineCapability({
    id: "device_set",
    area: "admin",
    title: "Approve or change a console",
    description: "Approves a waiting console, renames it, sets its admin flag, removes it, or cancels a waiting client download. Pick it by the code from device_list.",
    input: {
      type: "object",
      properties: {
        device: { type: "string", description: "The console's 8-character code from device_list, such as 3F9A01BC; for cancel_download its download id" },
        op: { type: "string", enum: Object.keys(OPS), description: "approve (or give a new key), rename, revoke (must pair again), admin (with on), or cancel_download" },
        label: { type: "string", description: "The name to give (approve and rename), up to 64 characters; approve keeps the console's own name when omitted" },
        on: { type: "boolean", description: "For op admin only: true lets the console change item settings, false makes it read only" },
      },
      required: ["device", "op"],
    },
    output: obj({ done: oneOf(["approve", "rename", "revoke", "admin", "cancel_download"]), code: str(), label: str(), admin: bool() }),
    preview: async (ctx, input) => {
      const { state, row } = check(input);
      if (state === "download") return { console: { code: row.id, state, name: `download of ${row.owner}`, admin: false }, op: input.op, refused: null, changes: "Cancels the download. A console that has not used it yet can no longer enroll with it." };
      const limit = input.op === "approve" ? accountFull(store.pendingDownload(row.deviceKey)?.owner ?? approver(ctx), row.deviceKey) : 0;
      return {
        console: { code: deviceCode(row.deviceKey), state, name: name(row), admin: row.admin === true },
        op: input.op,
        refused: limit ? `the account holds ${limit} consoles already, the most it may` : null,
        changes: {
          approve: state === "pending" ? "Approves it as its owner's console. It receives its new key on its next check." : "Gives it a new key; the old one stops working at once.",
          rename: `Renames it to "${String(input.label ?? "").trim().slice(0, 64)}".`,
          revoke: "Removes it. Its key stops working at once and it has to pair again.",
          admin: input.on ? "It may change item settings from the console." : "It can only read from now on.",
        }[input.op],
      };
    },
    previewOutput: obj({
      console: obj({ code: str(), state: oneOf(["pending", "approved", "download"]), name: str(), admin: bool() }),
      op: str(),
      refused: nullable(str("why approve would be refused")),
      changes: str(),
    }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/devices/approve" },
    also: ["POST /admin/api/devices/label", "POST /admin/api/devices/revoke", "POST /admin/api/devices/admin", "POST /admin/api/clients/:id/revoke"],
    mcp: true,
    handler: async (ctx, input) => {
      const { key, row } = check(input);
      if (input.op === "cancel_download") {
        enrollTokens.revoke(row.id);
        return { done: "cancel_download", code: row.id, label: `download of ${row.owner}`, admin: false };
      }
      if (input.op === "approve") {
        const result = approveWaitingDevice(key, { label: input.label, addedBy: approver(ctx) });
        if (!result.ok) throw fail(409, `the account holds ${result.limit} consoles already, the most it may`);
        return { done: "approve", code: deviceCode(key), label: result.label, admin: row.admin === true };
      }
      if (input.op === "rename") {
        store.renameDevice(key, input.label);
        return { done: "rename", code: deviceCode(key), label: String(input.label).trim().slice(0, 64), admin: row.admin === true };
      }
      if (input.op === "admin") {
        store.setDeviceAdmin(key, input.on);
        return { done: "admin", code: deviceCode(key), label: row.label ?? "", admin: store.isDeviceAdmin(key) };
      }
      store.revokeDevice(key);
      return { done: "revoke", code: deviceCode(key), label: name(row), admin: false };
    },
  }),
];
