import { test } from "node:test";
import assert from "node:assert/strict";
import { connectHowto } from "../../src/routes/admin/connect-howto.js";

const base = { devicePairing: true, deviceApproval: "signin", consolePasswords: true, accountPasswords: false, lanOnly: false };

test("with account passwords off, consoles are told to use the per-device logins only", () => {
  const [cf, cyber, tinfoil] = connectHowto(base);
  assert.match(cf, /QR/);
  assert.match(cf, /아이디와 비밀번호는 넣지 않습니다/);
  assert.match(cyber, /계정 비밀번호는 받지 않습니다/);
  assert.match(tinfoil, /같은 아이디와 비밀번호를 넣습니다/);
});

test("with account passwords on, either kind of login is offered", () => {
  assert.match(connectHowto({ ...base, accountPasswords: true })[1], /계정 아이디와 비밀번호, 또는/);
});

test("password consoles switched off are said to be off, not explained", () => {
  const lines = connectHowto({ ...base, consolePasswords: false });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /지금은 접속할 수 없습니다/);
});

test("home-network-only and manual approval show up in the lines", () => {
  assert.match(connectHowto({ ...base, lanOnly: true })[1], /집 안 네트워크에서만/);
  assert.match(connectHowto({ ...base, deviceApproval: "manual" })[0], /승인 대기에서 합니다/);
  assert.match(connectHowto({ ...base, devicePairing: false })[0], /QR 연결을 꺼 두어/);
});

test("the lines follow the house style: no em dashes, polite endings", () => {
  for (const s of [base, { ...base, consolePasswords: false }, { ...base, devicePairing: false, lanOnly: true }]) {
    for (const line of connectHowto(s)) {
      assert.ok(!/[—–]/.test(line), line);
      assert.match(line, /니다\.$|니다\.<\/?|됩니다\.$/);
    }
  }
});
