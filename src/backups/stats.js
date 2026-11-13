/**
 * What each account keeps in console backups, for the admin: per platform the units, versions, bytes and how
 * many secret files. Counts only: no unit, title, path or file is named, and a secret is never opened.
 */
import fs from "node:fs";
import path from "node:path";
import * as users from "../security/users.js";
import * as googleAccounts from "../security/google-accounts.js";
import { PLATFORMS } from "../platforms/index.js";
import { accountFolder, accountOfOwner } from "./account.js";
import * as store from "./store.js";

/** Every account the server knows, as { kind, name, id }. */
function accounts() {
  const out = [];
  for (const u of users.list()) {
    const a = accountOfOwner({ kind: "user", id: u.name });
    if (a) out.push({ kind: "user", name: u.name, id: a.id });
  }
  for (const g of googleAccounts.list()) {
    const a = accountOfOwner({ kind: "google", id: g.sub });
    if (a) out.push({ kind: "google", name: g.email ?? g.sub, id: a.id });
  }
  return out;
}

/** { on, accounts: [{ kind, name, bytes, platforms: [{ platform, units, versions, bytes, secrets }] }] }, accounts with backups only. */
export async function backupStats() {
  const root = store.backupsRoot();
  if (!root) return { on: false, accounts: [] };
  const out = [];
  for (const a of accounts()) {
    if (!fs.existsSync(path.join(root, accountFolder(a.id)))) continue;
    const platforms = [];
    for (const [platform, spec] of Object.entries(PLATFORMS)) {
      if (!spec.backupKinds.length) continue;
      const units = await store.listUnits(a.id, platform);
      if (!units.length) continue;
      platforms.push({
        platform, units: units.length, versions: units.reduce((n, u) => n + u.versions, 0),
        bytes: units.reduce((n, u) => n + u.bytes, 0), secrets: units.reduce((n, u) => n + u.secrets, 0),
      });
    }
    out.push({ kind: a.kind, name: a.name, bytes: await store.usedBytes(a.id), platforms });
  }
  return { on: true, accounts: out.sort((x, y) => y.bytes - x.bytes) };
}
