import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Operator alerts: only the events the admin left on, the same subject once per
// half hour, dangerous access gathered into one summary, and a history of all of it.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-alerts-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
process.env.COOK_TELEGRAM_CHAT_ID = "";
const integrations = await import("../../src/security/integrations.js");
const alerts = await import("../../src/helpers/alerts.js");

const TOKEN = "123456789:" + "A".repeat(35);
const settle = () => new Promise((r) => setImmediate(r));

function capture() {
  const sent = [];
  alerts.setFetchForTests(async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    return { json: async () => ({ ok: true }) };
  });
  return sent;
}

test("nothing is sent until a bot token and chat are saved", () => {
  const sent = capture();
  assert.equal(alerts.alert("device", "x", { subject: "k1" }), false);
  assert.equal(sent.length, 0);
});

test("an alert goes to the saved chat once per subject per half hour", async () => {
  integrations.save("telegram", { botToken: TOKEN, chatId: "-100123" });
  const sent = capture();
  const t0 = 1_000_000;
  assert.equal(alerts.alert("device", "메시지: 거실", { subject: "DEVICE-KEY-SECRET", now: t0 }), true);
  assert.equal(alerts.alert("device", "메시지: 거실", { subject: "DEVICE-KEY-SECRET", now: t0 + 60_000 }), false, "a repeat poll is not sent again");
  assert.equal(alerts.alert("device", "다른 기기", { subject: "OTHER", now: t0 + 60_000 }), true);
  assert.equal(alerts.alert("device", "메시지: 거실", { subject: "DEVICE-KEY-SECRET", now: t0 + 31 * 60_000 }), true);
  await settle();
  assert.equal(sent.length, 3);
  assert.match(sent[0].url, /\/sendMessage$/);
  assert.equal(sent[0].body.chat_id, "-100123");
  assert.match(sent[0].body.text, /^\[CookingFoil\] 기기 승인 요청\n메시지: 거실/);
  assert.ok(!sent.some((m) => m.body.text.includes("DEVICE-KEY-SECRET")), "the subject is never sent");
  const h = alerts.recent();
  assert.deepEqual(h.map((x) => x.status), ["sent", "sent", "held", "sent"], "newest first, the held repeat recorded too");
});

test("dangerous access: the first hit at once, the rest in one summary", async () => {
  const sent = capture();
  alerts.alert("probe", "알려진 공격 경로: /.env 를 로그인 전에 막았습니다.", { subject: "1.1.1.1", digest: { path: "/.env" } });
  for (const [ip, p] of [["1.1.1.1", "/wp-login.php"], ["2.2.2.2", "/wp-login.php"], ["3.3.3.3", "/.git/config"]]) {
    assert.equal(alerts.alert("probe", "x", { subject: ip, digest: { path: p } }), false, "gathered, not sent");
  }
  await settle();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /위험한 접근\n알려진 공격 경로: \/\.env/);
  alerts.flushForTests("probe");
  await settle();
  assert.equal(sent.length, 2);
  assert.match(sent[1].body.text, /3건을 더 막았습니다\. 주소 3곳에서 왔고, 많이 노린 경로는 \/wp-login\.php \(2\)/);
  assert.ok(!sent.some((m) => /\d+\.\d+\.\d+\.\d+/.test(m.body.text)), "no address is ever sent");
});

test("defaults: all seven on; '-' turns all off and a list picks", () => {
  assert.deepEqual(alerts.enabledEvents(""), ["device", "account", "lockout", "probe", "inbox", "direct", "nsz", "server"]);
  assert.deepEqual(alerts.enabledEvents("-"), []);
  assert.deepEqual(alerts.enabledEvents("server,lockout,nope"), ["server", "lockout"]);
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "lockout" });
  const sent = capture();
  assert.equal(alerts.alert("device", "x", { subject: "a" }), false);
  assert.equal(alerts.recent()[0].status, "off", "an event left off is still recorded");
  assert.equal(alerts.alert("lockout", "x", { subject: "a" }), true);
  assert.equal(alerts.alert("nope", "x"), false, "unknown events are dropped");
  assert.equal(sent.length, 1);
});

test("a test message names the events that are on", async () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "device,probe" });
  const sent = capture();
  assert.deepEqual(await alerts.test(), { ok: true, message: "시험 메시지를 보냈습니다" });
  assert.match(sent[0].body.text, /^\[CookingFoil\] 알림 시험\n.*기기 승인 요청, 위험한 접근/);
  alerts.setFetchForTests(async () => { throw new Error("ETIMEDOUT"); });
  assert.equal((await alerts.test()).ok, false);
  assert.equal(alerts.recent()[0].status, "failed");
});

test("saving keeps the token secret and checks the formats", () => {
  const d = integrations.describe().telegram;
  assert.deepEqual(d.fields.botToken, { set: true });
  assert.equal(d.configured, true, "events are optional");
  assert.throws(() => integrations.save("telegram", { botToken: "not-a-token" }), /botToken/);
  assert.throws(() => integrations.save("telegram", { chatId: "abc def" }), /chatId/);
  assert.throws(() => integrations.save("telegram", { chatId: "1", events: "device;rm" }), /events/);
});

test("recentChats lists each chat that wrote to the bot once", async () => {
  alerts.setFetchForTests(async () => ({ json: async () => ({ ok: true, result: [
    { message: { chat: { id: 42, first_name: "Me" } } },
    { message: { chat: { id: 42, first_name: "Me" } } },
    { my_chat_member: { chat: { id: -100, title: "Ops" } } },
  ] }) }));
  assert.deepEqual(await alerts.recentChats(TOKEN), [{ id: "42", title: "Me" }, { id: "-100", title: "Ops" }]);
  alerts.setFetchForTests(async () => ({ json: async () => ({ ok: false }) }));
  assert.equal(await alerts.recentChats(TOKEN), null);
});

test("each share-inbox upload is told at once, never held as a repeat of the last one", () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "inbox" });
  capture();
  assert.equal(alerts.alert("inbox", "alice 님이 파일 1개(1 B), 링크 0개를 올렸습니다.", { subject: "20261014-090000-alice-0001" }), true);
  assert.equal(alerts.alert("inbox", "alice 님이 파일 1개(1 B), 링크 0개를 올렸습니다.", { subject: "20261014-090001-alice-0002" }), true);
  assert.equal(alerts.EVENTS.inbox.label, "임시 공유");
});

test("a flood of new consoles sends a few buttons at once, then one summary without buttons", async () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "" });
  const sent = capture();
  const t0 = 5_000_000;
  let accepted = 0;
  for (let i = 0; i < 300; i++) {
    if (alerts.alert("device", `기기 코드 ${i}`, { subject: `KEY-${i}`, now: t0 + i, approval: { kind: "device", ref: `KEY-${i}` } })) accepted++;
  }
  await settle();
  assert.equal(accepted, alerts.APPROVAL_BURST);
  assert.equal(sent.length, alerts.APPROVAL_BURST, "the rest wait for the summary");
  assert.ok(sent.every((m) => m.body.reply_markup?.inline_keyboard), "the first ones carry buttons");
  alerts.flushForTests("device");
  await settle();
  assert.equal(sent.length, alerts.APPROVAL_BURST + 1);
  const summary = sent.at(-1).body;
  assert.match(summary.text, new RegExp(`${300 - alerts.APPROVAL_BURST}개 기기가 더 승인을 기다립니다`));
  assert.equal(summary.reply_markup, undefined, "the summary has no buttons");
  // The next window starts with buttons again, and a single console is told as before.
  const next = t0 + alerts.APPROVAL_WINDOW_MS + 1;
  assert.equal(alerts.alert("device", "기기 코드 X", { subject: "KEY-X", now: next, approval: { kind: "device", ref: "KEY-X" } }), true);
  await settle();
  assert.ok(sent.at(-1).body.reply_markup?.inline_keyboard);
});

test("the repeat guard forgets old subjects and holds a bounded number", () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "lockout" });
  capture();
  const t0 = 9_000_000;
  for (let i = 0; i < alerts.DEDUPE_MAX + 200; i++) alerts.alert("lockout", "x", { subject: `ip-${i}`, now: t0 });
  assert.equal(alerts.dedupeSizeForTests(), alerts.DEDUPE_MAX);
  alerts.alert("lockout", "x", { subject: "later", now: t0 + alerts.DEDUPE_MS });
  assert.equal(alerts.dedupeSizeForTests(), 1, "subjects past the window are forgotten");
});

test("a console queued quietly (past the hourly cap) raises no alert", async () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "" });
  const sent = capture();
  const store = await import("../../src/security/store.js");
  store.recordPendingDevice("Q".repeat(64), { quiet: true });
  assert.equal(store.isDevicePending("Q".repeat(64)), true);
  store.recordPendingDevice("R".repeat(64));
  await settle();
  assert.equal(sent.length, 1, "only the console that was not held back");
});
