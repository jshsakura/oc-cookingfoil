import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Operator alerts: only the events the admin ticked, the same subject once per
// half hour, and nothing that identifies the subject in the text sent.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-alerts-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
const integrations = await import("../../src/security/integrations.js");
const alerts = await import("../../src/helpers/alerts.js");

const TOKEN = "123456789:" + "A".repeat(35);

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
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 3);
  assert.match(sent[0].url, /\/sendMessage$/);
  assert.equal(sent[0].body.chat_id, "-100123");
  assert.match(sent[0].body.text, /^\[CookingFoil\] 기기 승인 요청\n메시지: 거실/);
  assert.ok(!sent.some((m) => m.body.text.includes("DEVICE-KEY-SECRET")), "the subject is never sent");
});

test("only the ticked events are sent; '-' turns them all off", () => {
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "lockout" });
  const sent = capture();
  assert.equal(alerts.alert("device", "x", { subject: "a" }), false);
  assert.equal(alerts.alert("lockout", "x", { subject: "a" }), true);
  integrations.save("telegram", { botToken: "", chatId: "-100123", events: "-" });
  assert.equal(alerts.alert("lockout", "x", { subject: "b" }), false);
  assert.equal(alerts.alert("nope", "x"), false, "unknown events are dropped");
  assert.equal(sent.length, 1);
});

test("saving keeps the token secret and checks the formats", () => {
  const d = integrations.describe().telegram;
  assert.deepEqual(d.fields.botToken, { set: true });
  assert.equal(d.configured, true, "events are optional");
  assert.throws(() => integrations.save("telegram", { botToken: "not-a-token" }), /botToken/);
  assert.throws(() => integrations.save("telegram", { chatId: "abc def" }), /chatId/);
  assert.throws(() => integrations.save("telegram", { chatId: "1", events: "device;rm" }), /events/);
});

test("wanted(): empty means all, '-' none, else the listed ones", () => {
  assert.equal(alerts.wanted("device", ""), true);
  assert.equal(alerts.wanted("device", "-"), false);
  assert.equal(alerts.wanted("device", "account,device"), true);
  assert.equal(alerts.wanted("lockout", "account,device"), false);
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
