import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-secwatch-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
process.env.COOK_TELEGRAM_CHAT_ID = "";
const integrations = await import("../../src/security/integrations.js");
const alerts = await import("../../src/helpers/alerts.js");
const store = await import("../../src/security/store.js");
const watch = await import("../../src/security/security-watch.js");

const settle = () => new Promise((r) => setImmediate(r));
const sent = [];
integrations.save("telegram", { botToken: "123456789:" + "A".repeat(35), chatId: "-100123" });
alerts.setFetchForTests(async (_url, opts) => {
  sent.push(JSON.parse(opts.body).text);
  return { json: async () => ({ ok: true }) };
});

test("a warning goes out once someone has spent half the failure budget, before the lockout", async () => {
  assert.equal(watch.warnAt(5), 3);
  assert.equal(watch.warnAt(2), null, "too small a budget to warn before it locks");
  assert.equal(watch.noteFailure("203.0.113.7", 2, "/login", 5), false);
  assert.equal(watch.noteFailure("203.0.113.7", 3, "/login", 5), true);
  assert.equal(watch.noteFailure("203.0.113.7", 4, "/login", 5), false);
  await settle();
  assert.match(sent.at(-1), /^🛡️ 보안 감시 · CookingFoil\n\n👀 203\.0\.113\.7 \(.+\) 에서 로그인을 3번 틀렸습니다\. 5번이 되면/);
});

test("the six-hour summary counts failures, lockouts and the busiest address, and stays quiet otherwise", async () => {
  const now = Date.now();
  assert.equal(watch.sendDigest(now), null, "nothing happened yet");
  for (let i = 0; i < 4; i++) store.appendAudit({ kind: "auth-fail", ip: "198.51.100.9", path: "/login", at: now - 1000 * i });
  store.appendAudit({ kind: "auth-fail", ip: "203.0.113.7", path: "/login", at: now - 5000 });
  store.appendAudit({ kind: "auth-fail", ip: "192.0.2.1", path: "/login", at: now - 7 * 60 * 60 * 1000 });
  store.lock("198.51.100.9", { reason: "test", ttlMs: 0 });
  const s = watch.sendDigest(now + 10);
  assert.equal(s.fails, 5, "the one older than six hours is left out");
  assert.equal(s.ips, 2);
  assert.equal(s.locks, 1);
  assert.equal(s.top, "198.51.100.9 (4)");
  await settle();
  assert.match(sent.at(-1), /📊 지난 6시간 보안 요약\n❌ 틀린 로그인 5번 \(주소 2곳\)\n🔒 새로 잠근 주소 1곳/);
});
