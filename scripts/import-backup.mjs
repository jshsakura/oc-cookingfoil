#!/usr/bin/env node
// The first backup of a console from a copy of its card on the server (src/backups/import.js). Run it where the
// server runs, with the server's own environment, so COOK_SECRET_KEY comes from the same .env:
//
//   node scripts/import-backup.mjs --platform vita --account <account> [--kinds app,patch,...] [--dry]
//
//   COOK_IMPORT_SOURCE   the card copy to read (only read)
//   COOK_BACKUPS_DIR     where the backups are
//
// It prints counts and bytes only: no title, path, hash or secret.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { platform: { type: "string" }, account: { type: "string" }, kinds: { type: "string" }, dry: { type: "boolean", default: false } },
  strict: true,
});
const fail = (text) => {
  process.stderr.write(`import-backup: ${text}\n`);
  process.exit(2);
};
if (values.platform !== "vita") fail("--platform vita is the only platform with backups");
if (!values.account) fail("--account names whose backups these are");
const source = process.env.COOK_IMPORT_SOURCE;
if (!source) fail("COOK_IMPORT_SOURCE names the card copy to read");

const { backupsCheck, compareKeyOnly } = await import("../src/backups/store.js");
const { accountNamed } = await import("../src/backups/account.js");
const { importUx0 } = await import("../src/backups/import.js");
const vita = (await import("../src/platforms/vita.js")).default;

compareKeyOnly();
const check = backupsCheck();
const OFF = {
  unset: "backups are off: COOK_BACKUPS_DIR is not set",
  missing: "backups are off: COOK_BACKUPS_DIR is not a folder",
  inside: "backups are off: COOK_BACKUPS_DIR lies inside one of the server's own folders",
  "key-missing": "the server has not turned backups on with its key yet: start the server with COOK_BACKUPS_DIR set, then import; nothing was imported",
  "key-mismatch": "COOK_SECRET_KEY is not the key the server seals backups with; nothing was imported",
  "key-unreadable": "the backups' key check could not be read; nothing was imported",
};
if (!check.root && (!values.dry || !check.reason.startsWith("key-"))) fail(OFF[check.reason] ?? "backups are off");
const account = accountNamed(values.account);
if (!account) fail("no such account");
const kinds = values.kinds ? values.kinds.split(",").map((k) => k.trim()).filter(Boolean) : null;
if (kinds?.some((k) => !vita.backupKinds.includes(k))) fail("--kinds names a kind the Vita does not have");

const gib = (n) => `${(n / 1024 ** 3).toFixed(2)} GiB`;
let shown = 0;
// A failure says what kind it was, never which file: a path on the card can name a licence.
process.on("uncaughtException", (err) => fail(`stopped: ${err.code ?? err.name ?? "error"}`));
process.on("unhandledRejection", (err) => fail(`stopped: ${err?.code ?? err?.name ?? "error"}`));
const totals = await importUx0({
  ux0: source, accountId: account.id, kinds, dry: values.dry,
  report: ({ done, of }) => {
    if (done === of || Date.now() - shown > 10_000) {
      shown = Date.now();
      process.stdout.write(`units ${done}/${of}\n`);
    }
  },
});
process.stdout.write(`${values.dry ? "would import" : "imported"}: units ${totals.units}, files ${totals.files}, secret files ${totals.secrets}, ${gib(totals.bytes)}`
  + (values.dry ? "\n" : `; new versions ${totals.added}, unchanged ${totals.kept}\n`));
process.exit(0);
