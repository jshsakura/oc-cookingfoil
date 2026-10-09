import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The user store seeds itself from COOK_AUTH_USERS at module load, so every
// scenario runs in its own child process with the env pinned up front.

function run(script, env = {}) {
  const dataDir = env.COOK_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "cf-users-"));
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import * as users from "../../src/security/users.js";
    const out = await (async () => { ${script} })();
    process.stdout.write(JSON.stringify(out ?? null));
  `], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_AUTH_USERS: "", ...env, COOK_DATA_DIR: dataDir },
  });
  return { out: JSON.parse(out.toString()), dataDir };
}

test("existing COOK_AUTH_USERS accounts keep their passwords after the first start", () => {
  const { out, dataDir } = run(
    `return { list: users.list().map((u) => u.name), ok: users.verify("cc", "pw-cc-123"), bad: users.verify("cc", "nope") };`,
    { COOK_AUTH_USERS: "tinfoil:pw-tin-123,cc:pw-cc-123" },
  );
  assert.deepEqual(out.list, ["tinfoil", "cc"]);
  assert.equal(out.ok, true);
  assert.equal(out.bad, false);
  const saved = readFileSync(path.join(dataDir, "security", "users.json"), "utf8");
  assert.ok(!saved.includes("pw-cc-123"), "passwords are stored hashed, never in plain text");
});

test("once the file exists it is the source of truth, not the env", () => {
  const { dataDir } = run(`users.remove("cc"); return null;`, { COOK_AUTH_USERS: "tinfoil:pw-tin-123,cc:pw-cc-123" });
  const { out } = run(`return users.list().map((u) => u.name);`, { COOK_DATA_DIR: dataDir, COOK_AUTH_USERS: "tinfoil:pw-tin-123,cc:pw-cc-123" });
  assert.deepEqual(out, ["tinfoil"]);
});

test("no env users and no file means auth stays off until an account is added", () => {
  const { out, dataDir } = run(`
    const before = users.hasUsers();
    const created = users.add("guest");
    return { before, after: users.hasUsers(), password: created.password, ok: users.verify("guest", created.password) };
  `);
  assert.equal(out.before, false);
  assert.equal(out.after, true);
  assert.ok(out.password.length >= 16, "a generated password is long enough to be the only factor");
  assert.equal(out.ok, true);
  assert.ok(existsSync(path.join(dataDir, "security", "users.json")));
});

test("password reset, disable and remove take effect immediately, even for a cached login", () => {
  const { out } = run(`
    const first = users.verify("a", "first-pass-1");
    const reset = users.setPassword("a");
    const oldAfterReset = users.verify("a", "first-pass-1");
    const newOk = users.verify("a", reset.password);
    users.setEnabled("a", false);
    const disabled = users.verify("a", reset.password);
    users.setEnabled("a", true);
    users.remove("a", { allowEmpty: true });
    const removed = users.verify("a", reset.password);
    return { first, oldAfterReset, newOk, disabled, removed, left: users.hasUsers() };
  `, { COOK_AUTH_USERS: "a:first-pass-1" });
  assert.deepEqual(out, { first: true, oldAfterReset: false, newOk: true, disabled: false, removed: false, left: false });
});

test("names and passwords that would break basic auth are refused", () => {
  const { out } = run(`
    const errors = [];
    for (const [name, pass] of [["bad name", "long-enough-1"], ["a:b", "long-enough-1"], ["ok", "short"], ["", "long-enough-1"]]) {
      try { users.add(name, pass); errors.push(null); } catch (e) { errors.push(e.code); }
    }
    users.add("dup", "long-enough-1");
    try { users.add("dup", "long-enough-2"); errors.push(null); } catch (e) { errors.push(e.code); }
    try { users.remove("ghost"); errors.push(null); } catch (e) { errors.push(e.code); }
    return errors;
  `);
  assert.deepEqual(out, ["invalid-name", "invalid-name", "weak-password", "invalid-name", "exists", "not-found"]);
});

test("list never exposes password hashes", () => {
  const { out } = run(`return users.list();`, { COOK_AUTH_USERS: "a:first-pass-1" });
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ["createdAt", "enabled", "name", "updatedAt"]);
});

test("the last account cannot be removed by accident, because that opens the server", () => {
  const { out } = run(`
    let code = null;
    try { users.remove("only"); } catch (e) { code = e.code; }
    return { code, still: users.hasUsers() };
  `, { COOK_AUTH_USERS: "only:only-pass-1" });
  assert.deepEqual(out, { code: "last-user", still: true });
});

test("async verification agrees with the sync check and rejects unknown names", async () => {
  const { out } = run(`
    return {
      ok: await users.verifyAsync("a", "first-pass-1"),
      bad: await users.verifyAsync("a", "wrong-pass-1"),
      ghost: await users.verifyAsync("ghost", "first-pass-1"),
    };
  `, { COOK_AUTH_USERS: "a:first-pass-1" });
  assert.deepEqual(out, { ok: true, bad: false, ghost: false });
});

test("env passwords keep everything after the first colon", () => {
  const { out } = run(`return users.verify("a", "pa:ss:word-1");`, { COOK_AUTH_USERS: "a:pa:ss:word-1" });
  assert.equal(out, true);
});

test("a users file without a users object refuses to start instead of opening the server", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "cf-users-"));
  mkdirSync(path.join(dataDir, "security"), { recursive: true });
  writeFileSync(path.join(dataDir, "security", "users.json"), JSON.stringify({ version: 1 }));
  assert.throws(() => run(`return users.hasUsers();`, { COOK_DATA_DIR: dataDir }));
});
