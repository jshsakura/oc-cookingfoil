/**
 * Accounts that may sign in: password users and Google accounts, in one list and one action.
 * Making a user or resetting a password hands a new password back, and Google sign-in settings hold
 * a secret, so neither is a tool: a secret must never reach a chat. The routes refuse tokens, so
 * these are served by MCP alone (mcp: true), behind the preview and confirm='approve'.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, obj, oneOf, str } from "./shape.js";
import * as users from "../security/users.js";
import * as google from "../security/google-accounts.js";
import * as store from "../security/store.js";
import * as enrollTokens from "../security/enroll-tokens.js";
import { revokeOwnedBy } from "../security/account-access.js";
import { SYSTEM_APPROVERS } from "../security/users.js";
import * as envs from "../helpers/envs.js";

const GOOGLE = "google:";
const OPS = ["enable", "disable", "role", "remove"];
const HTTP_OF = { "invalid-name": 400, "weak-password": 400, "invalid-role": 400, "not-found": 404, "last-user": 409, "last-admin": 409 };

const fail = (status, message) => Object.assign(new Error(message), { status });
const lastActive = (owner) => store.lastActiveOf(owner) ?? null;

/** The account this id names: { kind, id, owner, row }. `owner` is what its consoles record as approver. */
function find(raw) {
  const id = String(raw ?? "");
  if (id.startsWith(GOOGLE)) {
    const row = google.get(id.slice(GOOGLE.length));
    if (!row) throw fail(404, `no Google account ${id}; account_list shows the ids`);
    return { kind: "google", id, owner: `${GOOGLE}${row.email}`, row };
  }
  const row = users.list().find((u) => u.name === id);
  if (!row) throw fail(404, `no account ${id}; account_list shows the ids`);
  return { kind: "password", id, owner: id, row };
}

const isSelf = (ctx, acct) => ctx.token?.owner === acct.id;

function check(ctx, input) {
  if (!OPS.includes(input.op)) throw fail(400, `op is one of ${OPS.join(", ")}`);
  if (input.op === "role" && !["admin", "user"].includes(input.role)) throw fail(400, "role needs role: admin or user");
  const acct = find(input.account);
  const lowering = input.op === "disable" || input.op === "remove" || (input.op === "role" && input.role !== "admin");
  if (lowering && isSelf(ctx, acct)) throw fail(409, "A token cannot disable, demote or remove the account that owns it");
  if (input.op === "remove" && acct.kind === "password" && !envs.passwordLogin && users.list().length === 1) {
    throw fail(409, "That is the only password account and Google sign-in is off; removing it would leave the server open");
  }
  return acct;
}

/** What ending this account's access would revoke: the consoles it approved and the downloads it minted. */
function reach(acct) {
  if (SYSTEM_APPROVERS.has(acct.owner)) return { consoles: 0, enrollTokens: 0 };
  return {
    consoles: store.devicesSnapshot().approved.filter((d) => d.addedBy === acct.owner).length,
    enrollTokens: enrollTokens.list({ owner: acct.owner }).length,
  };
}

const ROW = obj({
  id: str("account id: the user name, or google:<sub>"),
  kind: oneOf(["password", "google"]),
  name: str("user name, or the Google email"),
  role: oneOf(["admin", "user"]),
  state: oneOf(["on", "off", "pending"], "on may sign in; off is disabled; pending waits for approval"),
  lastActiveAt: nullable(int("epoch ms a console it approved last connected")),
});

export const accountsCapabilities = [
  defineCapability({
    id: "account_list",
    area: "admin",
    title: "List accounts",
    description: "Lists the password users and Google accounts that may sign in, each with the id account_set takes. Read before enabling, disabling or removing one.",
    input: { type: "object", properties: {} },
    output: obj({ accounts: arr(ROW), googleSignIn: bool("Google sign-in is configured") }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/accounts" },
    also: ["GET /admin/api/users"],
    handler: async () => ({
      googleSignIn: (await import("../security/google-config.js")).googleConfigured(),
      accounts: [
        ...users.list().map((u) => ({ id: u.name, kind: "password", name: u.name, role: u.role, state: u.enabled ? "on" : "off", lastActiveAt: lastActive(u.name) })),
        ...google.list().map((a) => ({ id: `${GOOGLE}${a.sub}`, kind: "google", name: a.email, role: a.role, state: a.status === "approved" ? "on" : a.status === "pending" ? "pending" : "off", lastActiveAt: lastActive(`${GOOGLE}${a.email}`) })),
      ],
    }),
  }),
  defineCapability({
    id: "account_set",
    area: "admin",
    title: "Change or remove an account",
    description: "Enables or disables an account, sets its role, or removes it. Disabling or removing also ends the consoles it approved. Not for your own token's account.",
    input: {
      type: "object",
      properties: {
        account: { type: "string", description: "The account id from account_list: a user name, or google:<sub>" },
        op: { type: "string", enum: OPS, description: "enable, disable, role (with role) or remove; disable and remove end its consoles" },
        role: { type: "string", enum: ["admin", "user"], description: "For op role only: the role to give the account" },
      },
      required: ["account", "op"],
    },
    output: obj({ done: oneOf(OPS), account: str(), revoked: obj({ consoles: int(), enrollTokens: int() }) }),
    preview: async (ctx, input) => {
      const acct = check(ctx, input);
      const ends = input.op === "disable" || input.op === "remove";
      return {
        account: { id: acct.id, kind: acct.kind, name: acct.kind === "google" ? acct.row.email : acct.id },
        op: input.op,
        revokes: ends ? reach(acct) : { consoles: 0, enrollTokens: 0 },
        changes: {
          enable: "It may sign in again. Consoles it had approved were revoked when it was disabled and stay gone.",
          disable: "It can no longer sign in, and the consoles and downloads it approved stop working.",
          role: `Its role becomes ${input.role}.`,
          remove: "The account is deleted, with its consoles and downloads. It would have to be made again.",
        }[input.op],
      };
    },
    previewOutput: obj({
      account: obj({ id: str(), kind: oneOf(["password", "google"]), name: str() }),
      op: str(),
      revokes: obj({ consoles: int("consoles that stop working"), enrollTokens: int("pending downloads that stop working") }),
      changes: str(),
    }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/accounts/status" },
    also: ["POST /admin/api/accounts/role", "POST /admin/api/accounts/remove", "POST /admin/api/users/:name/enabled", "POST /admin/api/users/:name/role", "DELETE /admin/api/users/:name"],
    mcp: true,
    handler: async (ctx, input) => {
      const acct = check(ctx, input);
      const revoked = { consoles: 0, enrollTokens: 0 };
      const end = () => Object.assign(revoked, (({ consoles, tokens }) => ({ consoles, enrollTokens: tokens }))(revokeOwnedBy(acct.owner)));
      try {
        if (acct.kind === "password") {
          if (input.op === "enable" || input.op === "disable") users.setEnabled(acct.id, input.op === "enable");
          else if (input.op === "role") users.setRole(acct.id, input.role);
          else users.remove(acct.id);
          if (input.op === "disable" || input.op === "remove") {
            if (input.op === "remove") store.forgetLogins(acct.id);
            end();
          }
        } else {
          const sub = acct.id.slice(GOOGLE.length);
          if (input.op === "enable") google.setStatus(sub, "approved");
          else if (input.op === "disable") google.setStatus(sub, "disabled");
          else if (input.op === "role") google.setRole(sub, input.role);
          else {
            google.remove(sub);
            store.forgetLogins(acct.id);
          }
          if (input.op === "disable" || input.op === "remove") end();
        }
      } catch (err) {
        if (err.code && HTTP_OF[err.code]) throw fail(HTTP_OF[err.code], err.message);
        throw err;
      }
      return { done: input.op, account: acct.id, revoked };
    },
  }),
];
