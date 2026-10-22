/**
 * A press on an approval alert's [승인] [거절] button (telegram-updates.js hands
 * it here). Acted on only when it comes from the chat the alerts go to and, in
 * a group or channel, from a Telegram user the admin listed (approvers); being
 * a group admin is not enough. Anyone else gets an answer and nothing changes.
 * The token is then spent, whatever happens next.
 *
 * Approving and refusing run the same functions as the admin page, so the
 * audit log and what the console or account sees are the same. A request the
 * admin page already handled is left alone. The alert is then rewritten to say
 * who did what, and its buttons go.
 */
import debug from "../debug.js";
import * as alerts from "../helpers/alerts.js";
import { translator } from "../helpers/alert-messages.js";
import * as integrations from "./integrations.js";
import * as approvalTokens from "./approval-tokens.js";
import * as store from "./store.js";
import * as accounts from "./google-accounts.js";
import { approveWaitingDevice } from "./pairing-approve.js";


export const SPENT = translator()("spent");

/** What each kind of request is, and how the admin page approves or refuses it. */
const KINDS = {
  device: {
    waiting: (key) => store.isDevicePending(key),
    approve: (key) => approveWaitingDevice(key, { addedBy: "telegram" }),
    // The devices tab's 거절: the request goes, and comes back if the console asks again.
    refuse: (key) => store.revokeDevice(key),
    refused: "refusedDevice",
  },
  account: {
    waiting: (sub) => accounts.get(sub)?.status === "pending",
    approve: (sub) => accounts.setStatus(sub, "approved"),
    refuse: (sub) => accounts.setStatus(sub, "disabled"),
    refused: "refusedAccount",
  },
};

/** The configured chat, by its id or, for a public one, its @name. */
function sameChat(chat, chatId) {
  if (!chat || !chatId) return false;
  if (chatId.startsWith("@")) return typeof chat.username === "string" && `@${chat.username}`.toLowerCase() === chatId.toLowerCase();
  return String(chat.id) === chatId;
}

/** In a private chat the person is the chat; elsewhere only the listed approvers may decide. */
function mayDecide(conf, chat, from) {
  if (from?.id === undefined) return false;
  if (chat.type === "private") return String(chat.id) === String(from.id);
  return String(conf.approvers ?? "").split(",").includes(String(from.id));
}

const who = (from, t) => String(from?.first_name || from?.username || t("someone")).slice(0, 64);

/** Approves or refuses the request; resolves to the line to show, and whether it was acted on. */
function decide(request, yes, t) {
  const kind = KINDS[request.kind];
  if (!kind) return { done: false, line: t("spent") };
  if (!kind.waiting(request.ref)) return { done: false, line: t("handled") };
  if (yes) {
    const result = kind.approve(request.ref);
    if (result?.ok === false) return { done: false, line: t("deviceLimit", { n: result.limit }) };
  } else kind.refuse(request.ref);
  debug.log("telegram: a %s request was %s from the chat", request.kind, yes ? "approved" : "refused");
  return { done: true, line: t(yes ? "approved" : kind.refused) };
}

/**
 * Handles one callback_query. Resolves to what happened, for the tests:
 * "other-chat" | "not-allowed" | "spent" | "handled" | "approved" | "refused".
 */
export async function handleCallback(q, conf = integrations.get("telegram")) {
  const t = translator(alerts.alertLang(conf));
  const answer = (text) => alerts.callTelegram(conf.botToken, "answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => {});
  const chat = q?.message?.chat;
  if (!sameChat(chat, conf.chatId)) {
    await answer(t("otherChat"));
    return "other-chat";
  }
  if (!mayDecide(conf, chat, q.from)) {
    await answer(t("notAllowed"));
    return "not-allowed";
  }
  const m = /^([yn]):(.+)$/.exec(String(q.data ?? ""));
  const request = m && approvalTokens.take(m[2]);
  if (!request) {
    await answer(t("spent"));
    return "spent";
  }
  const yes = m[1] === "y";
  const { done, line } = decide(request, yes, t);
  await answer(line);
  const footer = done ? t("decidedBy", { who: who(q.from, t), line }) : `${line}.`;
  await alerts.callTelegram(conf.botToken, "editMessageText", {
    chat_id: chat.id,
    message_id: q.message.message_id,
    text: `${q.message.text ?? ""}\n\n${footer}`.slice(0, 4096),
    disable_web_page_preview: true,
  }).catch((err) => debug.log("telegram: alert not rewritten: %s", err.message));
  if (!done) return "handled";
  return yes ? "approved" : "refused";
}
