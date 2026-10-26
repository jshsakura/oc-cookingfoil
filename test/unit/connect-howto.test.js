import { test } from "node:test";
import assert from "node:assert/strict";
import { connectHowto } from "../../src/routes/admin/connect-howto.js";

const base = { devicePairing: true, deviceApproval: "signin", accountPasswords: true };

test("how to connect, then how to start it again from the home-screen shortcut", () => {
  const lines = connectHowto(base);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /QR/);
  assert.match(lines[1], /바로가기 설치를 안내합니다\. 바로가기를 설치한 뒤에는 그 바로가기로 다시 실행해야 합니다\./);
  assert.doesNotMatch(lines.join(" "), /Tinfoil|CyberFoil/);
});

test("an ID and password count once, at pairing, only where they approve the console", () => {
  assert.match(connectHowto(base)[0], /연결할 때 한 번만 확인해 바로 승인하고, 그 뒤로는 기기 키로만/);
  for (const s of [{ ...base, accountPasswords: false }, { ...base, deviceApproval: "manual" }, { ...base, deviceApproval: "all" }]) {
    assert.match(connectHowto(s)[0], /콘솔은 비밀번호를 쓰지 않습니다/, JSON.stringify(s));
  }
});

test("manual approval and pairing switched off show up in the line", () => {
  assert.match(connectHowto({ ...base, deviceApproval: "manual" })[0], /승인 대기에서 합니다/);
  assert.match(connectHowto({ ...base, devicePairing: false })[0], /QR 연결을 꺼 두어 지금은 콘솔이 접속할 수 없습니다/);
});

test("the lines follow the house style: no em dashes, polite endings", () => {
  // The lines are swappable spans now, so the wording checks read the text with the markup stripped.
  for (const s of [base, { ...base, deviceApproval: "all" }, { ...base, devicePairing: false }]) {
    for (const line of connectHowto(s)) {
      const text = line.replace(/<[^>]+>/g, "");
      assert.ok(!/[—–]/.test(text), text);
      assert.match(text, /니다\.$/);
    }
  }
});
