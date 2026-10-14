import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Approving from Telegram: approval alerts carry [승인] [거절] buttons that stand
// for one-time tokens, a long-poll loop reads the presses, and a press acts only
// from the alerts' chat, through the same functions as the admin page.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-tg-approve-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
process.env.COOK_TELEGRAM_CHAT_ID = "";
process.env.COOK_TELEGRAM_BUTTONS = "";
process.env.COOK_ADMIN_EMAIL = "owner@example.com";
const integrations = await import("../../src/security/integrations.js");
const alerts = await import("../../src/helpers/alerts.js");
const tokens = await import("../../src/security/approval-tokens.js");
const store = await import("../../src/security/store.js");
const accounts = await import("../../src/security/google-accounts.js");
const { takeAccessKeyDelivery } = await import("../../src/security/pairing.js");
const { deviceCode } = await import("../../src/security/pairing-link.js");
const { handleCallback, SPENT } = await import("../../src/security/telegram-approve.js");
const updates = await import("../../src/security/telegram-updates.js");

const TOKEN = "123456789:" + "A".repeat(35);
const settle = () => new Promise((r) => setImmediate(r));
async function until(cond, what) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await settle();
  }
  assert.fail(`timed out waiting for ${what}`);
}
let keyN = 0;
const newKey = () => (++keyN).toString(16).toUpperCase().padStart(64, "A");

/**
 * A fake Bot API: records every call; `getUpdates` takes the next of `batches`
 * (an answer, or an Error to throw), then waits until the loop is stopped.
 */
function fakeTelegram({ batches = [], member = "member" } = {}) {
  const calls = [];
  alerts.setFetchForTests(async (url, opts = {}) => {
    const method = url.split("/").pop();
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, body });
    let answer = { ok: true, result: { message_id: 7 } };
    if (method === "getChatMember") answer = { ok: true, result: { status: member } };
    if (method === "getUpdates" && body) {
      if (!batches.length) {
        return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }
      const next = batches.shift();
      if (next instanceof Error) throw next;
      answer = next;
    }
    return { status: 200, json: async () => answer };
  });
  const of = (m) => calls.filter((c) => c.method === m);
  return { calls, of, tokenOf: (i = -1) => of("sendMessage").at(i).body.reply_markup.inline_keyboard[0][0].callback_data.slice(2) };
}

const press = (token, { yes = true, chat = { id: 42, type: "private", first_name: "민수" }, from = { id: 42, first_name: "민수" } } = {}) => ({
  id: "q1",
  from,
  data: `${yes ? "y" : "n"}:${token}`,
  message: { message_id: 7, chat, text: "[CookingFoil] 기기 승인 요청\n메시지: 거실" },
});

const useChat = (chatId, extra = {}) => integrations.save("telegram", { botToken: TOKEN, chatId, buttons: "on", ...extra });

after(() => updates.resetForTests());

test("buttons are on unless the admin turns them off", async () => {
  integrations.save("telegram", { botToken: TOKEN, chatId: "42" });
  const tg = fakeTelegram();
  alerts.alert("device", "x", { subject: newKey(), approval: { kind: "device", ref: "k" } });
  await settle();
  assert.ok(tg.of("sendMessage")[0].body.reply_markup, "a configured bot gets buttons with nothing saved");
  assert.equal(alerts.buttonsOn(), true);
  assert.equal(alerts.buttonsOn({ buttons: "off" }), false);
});

test("the device alert shows the code to compare with the console's screen", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key, { message: "거실" });
  await settle();
  const text = tg.of("sendMessage")[0].body.text;
  assert.match(text, new RegExp(`기기 코드 ${deviceCode(key)}`));
  assert.match(text, /메시지: 거실/);
  assert.ok(!text.includes(key), "the key itself is never sent");
});

test("only the approval alerts carry buttons, and only while buttons are on", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  alerts.alert("device", "메시지: 거실", { subject: key, approval: { kind: "device", ref: key } });
  alerts.alert("lockout", "잠갔습니다", { subject: "1.2.3.4" });
  await settle();
  const [withButtons, plain] = tg.of("sendMessage").map((c) => c.body);
  const row = withButtons.reply_markup.inline_keyboard[0];
  assert.deepEqual(row.map((b) => b.text), ["승인", "거절"]);
  assert.match(row[0].callback_data, /^y:[A-Za-z0-9_-]{22}$/);
  assert.equal(row[1].callback_data, `n:${row[0].callback_data.slice(2)}`, "one token for both buttons");
  assert.ok(row[0].callback_data.length <= 64, "within Telegram's callback_data limit");
  assert.ok(!JSON.stringify(withButtons).includes(key), "the device key is never sent");
  assert.equal(plain.reply_markup, undefined, "a lockout has nothing to approve");

  useChat("42", { buttons: "off" });
  alerts.alert("device", "x", { subject: newKey(), approval: { kind: "device", ref: "k" } });
  await settle();
  assert.equal(tg.of("sendMessage").at(-1).body.reply_markup, undefined);
});

test("a valid press approves the console the same way the devices tab does", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key, { message: "거실" });
  await settle();
  assert.equal(await handleCallback(press(tg.tokenOf())), "approved");
  assert.ok(store.isDeviceApproved(key));
  assert.ok(takeAccessKeyDelivery(key), "the console's key waits for its next poll");
  const row = store.devicesSnapshot().approved.find((d) => d.deviceKey === key);
  assert.deepEqual([row.label, row.addedBy], ["거실", "telegram"], "named by its note, like the admin page");
  assert.equal(tg.of("answerCallbackQuery")[0].body.text, "승인했습니다");
  const edit = tg.of("editMessageText")[0].body;
  assert.match(edit.text, /메시지: 거실\n\n민수 님이 승인했습니다\.$/);
  assert.equal(edit.reply_markup, undefined, "the buttons go");
});

test("a second press of the same button changes nothing", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key);
  await settle();
  const token = tg.tokenOf();
  assert.equal(await handleCallback(press(token)), "approved");
  takeAccessKeyDelivery(key);
  assert.equal(await handleCallback(press(token, { yes: false })), "spent");
  assert.ok(store.isDeviceApproved(key), "not refused afterwards");
  assert.equal(takeAccessKeyDelivery(key), null, "no new key minted");
  assert.equal(tg.of("answerCallbackQuery").at(-1).body.text, SPENT);
  assert.equal(tg.of("editMessageText").length, 1, "the first result stays on the message");
});

test("a press from another chat, or in a group from someone not on the list, is ignored", async () => {
  useChat("-1001", { approvers: "6" });
  const tg = fakeTelegram({ member: "administrator" });
  const key = newKey();
  store.recordPendingDevice(key);
  await settle();
  const token = tg.tokenOf();
  const group = { id: -1001, type: "supergroup", title: "가족" };
  assert.equal(await handleCallback(press(token, { chat: { id: 99, type: "private" }, from: { id: 99 } })), "other-chat");
  assert.equal(await handleCallback(press(token, { chat: group, from: { id: 5 } })), "not-allowed", "a group admin is not enough");
  assert.equal(await handleCallback(press(token, { chat: { id: 42, type: "private" }, from: { id: 42 } })), "other-chat", "the listed person's own chat isn't the alerts' chat");
  assert.ok(store.isDevicePending(key), "still waiting");
  assert.equal(tg.of("editMessageText").length, 0);
  assert.equal(tg.of("getChatMember").length, 0, "the list decides, not group roles");

  assert.equal(await handleCallback(press(token, { chat: group, from: { id: 6, first_name: "관리" } })), "approved", "the token was not spent by the ignored presses");

  useChat("-1001", { approvers: "" });
  store.recordPendingDevice(newKey());
  await settle();
  assert.equal(await handleCallback(press(tg.tokenOf(), { chat: group, from: { id: 6 } })), "not-allowed", "an empty list lets no one in a group");
});

test("in the private chat the alerts go to, its person may decide without a list", async () => {
  useChat("42", { approvers: "" });
  const tg = fakeTelegram();
  store.recordPendingDevice(newKey());
  await settle();
  assert.equal(await handleCallback(press(tg.tokenOf(), { from: { id: 77 } })), "not-allowed", "someone else in a private chat can't happen, but is refused");
  assert.equal(await handleCallback(press(tg.tokenOf())), "approved");
});

test("the approver list is checked when saved", () => {
  assert.throws(() => useChat("-1001", { approvers: "6;rm" }), /approvers/);
  assert.equal(useChat("-1001", { approvers: "6,123456789" }).fields.approvers.value, "6,123456789");
});

test("an expired or unknown token is refused", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key);
  const old = tokens.issue("device", key, Date.now() - tokens.TTL_MS - 1000);
  assert.equal(await handleCallback(press(old)), "spent");
  assert.equal(await handleCallback(press("x".repeat(22))), "spent");
  assert.equal(await handleCallback({ ...press(""), data: "y:../../etc" }), "spent");
  assert.ok(store.isDevicePending(key));
  assert.ok(tg.of("answerCallbackQuery").every((c) => c.body.text === SPENT));
});

test("refusing a console drops its request; an account is turned off or approved", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key);
  await settle();
  assert.equal(await handleCallback(press(tg.tokenOf(), { yes: false })), "refused");
  assert.ok(!store.isDevicePending(key) && !store.isDeviceApproved(key));
  assert.match(tg.of("editMessageText")[0].body.text, /민수 님이 거절했습니다\. 기기가 다시 요청하면 또 알립니다\.$/);

  accounts.signIn({ sub: "g-no", email: "no@example.com" });
  await settle();
  assert.equal(await handleCallback(press(tg.tokenOf(), { yes: false })), "refused");
  assert.equal(accounts.get("g-no").status, "disabled");
  accounts.signIn({ sub: "g-yes", email: "yes@example.com" });
  await settle();
  assert.ok(!JSON.stringify(tg.of("sendMessage").at(-1).body).includes("yes@example.com"), "no e-mail is sent");
  assert.equal(await handleCallback(press(tg.tokenOf())), "approved");
  assert.equal(accounts.get("g-yes").status, "approved");
});

test("a request the admin page already handled is left alone, and the buttons go", async () => {
  useChat("42");
  const tg = fakeTelegram();
  const key = newKey();
  store.recordPendingDevice(key);
  await settle();
  store.revokeDevice(key); // the devices tab's 거절
  assert.equal(await handleCallback(press(tg.tokenOf())), "handled");
  assert.ok(!store.isDeviceApproved(key));
  assert.equal(tg.of("answerCallbackQuery")[0].body.text, "이미 관리 화면에서 처리한 요청입니다");
  assert.match(tg.of("editMessageText")[0].body.text, /\n\n이미 관리 화면에서 처리한 요청입니다\.$/);
});

test("the loop doesn't start without a token, a chat and buttons on", async () => {
  await updates.resetForTests();
  const tg = fakeTelegram();
  integrations.clear("telegram");
  updates.sync();
  assert.equal(updates.running(), false);
  integrations.save("telegram", { botToken: TOKEN, chatId: "" });
  updates.sync();
  assert.equal(updates.running(), false, "no chat yet");
  useChat("42", { buttons: "off" });
  updates.sync();
  assert.equal(updates.running(), false, "buttons off");
  await settle();
  assert.equal(tg.of("getUpdates").length, 0);
});

test("the loop acknowledges each update once and hands presses on", async () => {
  await updates.resetForTests();
  useChat("42");
  const key = newKey();
  store.recordPendingDevice(key);
  const token = tokens.issue("device", key);
  const tg = fakeTelegram({ batches: [
    { ok: true, result: [{ update_id: 10, callback_query: press(token) }, { update_id: 11, message: { chat: { id: 42, first_name: "민수" } } }] },
    { ok: true, result: [{ update_id: 10, callback_query: press(token, { yes: false }) }, { update_id: 12, message: { chat: { id: -5, title: "가족" } } }] },
  ] });
  updates.watch();
  await until(() => tg.of("getUpdates").length >= 3, "the third poll");
  const offsets = tg.of("getUpdates").map((c) => c.body.offset);
  assert.deepEqual(offsets, [0, 12, 13]);
  assert.equal(tg.of("getUpdates")[0].body.timeout, updates.POLL_S);
  assert.ok(store.isDeviceApproved(key));
  assert.equal(tg.of("answerCallbackQuery").length, 1, "the repeated update 10 was skipped");

  // The chat finder reads the loop's updates instead of a second getUpdates.
  const before = tg.calls.length;
  assert.deepEqual(await updates.recentChats(TOKEN), [{ id: "42", title: "민수" }, { id: "-5", title: "가족" }]);
  assert.equal(tg.calls.length, before, "no call of its own");
  assert.deepEqual(updates.recentUsers(), [{ id: "42", name: "민수" }], "who pressed or wrote, for picking approvers");

  // Turning buttons off on the alerts tab stops it at once.
  useChat("42", { buttons: "off" });
  assert.equal(updates.running(), false);
  await updates.stop();
});

test("failures back off and double instead of hammering Telegram", async () => {
  const waits = [];
  await updates.resetForTests({ sleep: async (ms) => { waits.push(ms); } });
  const conflict = { ok: false, error_code: 409, description: "Conflict" };
  const tg = fakeTelegram({ batches: [conflict, new Error("ECONNRESET"), conflict, conflict, { ok: true, result: [] }, conflict] });
  useChat("42");
  await until(() => tg.of("getUpdates").length >= 7, "the polls");
  await updates.stop();
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 2000], "doubles while it fails, starts over after a success");
  assert.equal(tg.of("getUpdates").length, 7, "one call per wait, no more");

  waits.length = 0;
  const bad = fakeTelegram({ batches: Array.from({ length: 12 }, () => ({ ok: false, error_code: 401 })) });
  await updates.resetForTests();
  updates.sync();
  await until(() => bad.of("getUpdates").length >= 12, "the polls");
  await updates.stop();
  assert.equal(Math.max(...waits), updates.BACKOFF_MAX_MS, "capped");
});

test("a new token waits for the old loop's last request to end", async () => {
  await updates.resetForTests();
  const OTHER = "987654321:" + "B".repeat(35);
  const calls = [];
  let release;
  alerts.setFetchForTests(async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    calls.push({ bot: url.includes(OTHER) ? "B" : "A", offset: body.offset });
    if (url.includes(TOKEN)) return new Promise((resolve) => { release = () => resolve({ json: async () => ({ ok: true, result: [{ update_id: 50, message: { chat: { id: 1 } } }] }) }); });
    return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  useChat("42");
  await until(() => calls.length === 1, "bot A polling");
  integrations.save("telegram", { botToken: OTHER, chatId: "42", buttons: "on" });
  const switched = updates.sync();
  await settle();
  assert.equal(calls.length, 1, "bot B waits while bot A's request is still out");
  release();
  await switched;
  await until(() => calls.length === 2, "bot B polling");
  assert.deepEqual(calls[1], { bot: "B", offset: 0 }, "A's late answer didn't move B's offset");
  await updates.stop();
});

test("the token file is written 0600 even over a loose leftover", () => {
  const dir = path.join(process.env.COOK_DATA_DIR, "security");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "telegram-approvals.json.tmp"), "{}", { mode: 0o644 });
  tokens.issue("device", newKey());
  assert.equal(statSync(path.join(dir, "telegram-approvals.json")).mode & 0o777, 0o600);
});

test("without the loop the chat finder still asks Telegram", async () => {
  await updates.resetForTests();
  integrations.clear("telegram");
  alerts.setFetchForTests(async () => ({ json: async () => ({ ok: true, result: [{ message: { chat: { id: 7, first_name: "Me" } } }] }) }));
  assert.deepEqual(await updates.recentChats(TOKEN), [{ id: "7", title: "Me" }]);
});
