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
import * as integrations from "./integrations.js";
import * as approvalTokens from "./approval-tokens.js";
import * as store from "./store.js";
import * as accounts from "./google-accounts.js";
import { approveWaitingDevice } from "./pairing-approve.js";

export const SPENT = "이미 처리했거나 만료된 요청입니다";
const HANDLED = "이미 관리 화면에서 처리한 요청입니다";

/** What each kind of request is, and how the admin page approves or refuses it. */
const KINDS = {
  device: {
    waiting: (key) => store.isDevicePending(key),
    approve: (key) => approveWaitingDevice(key, { addedBy: "telegram" }),
    // The devices tab's 거절: the request goes, and comes back if the console asks again.
    refuse: (key) => store.revokeDevice(key),
    refused: "거절했습니다. 기기가 다시 요청하면 또 알립니다",
  },
  account: {
    waiting: (sub) => accounts.get(sub)?.status === "pending",
    approve: (sub) => accounts.setStatus(sub, "approved"),
    refuse: (sub) => accounts.setStatus(sub, "disabled"),
    refused: "거절했습니다. 계정은 사용 중지 상태가 됩니다",
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

const who = (from) => String(from?.first_name || from?.username || "누군가").slice(0, 64);

/** Approves or refuses the request; resolves to the line to show, and whether it was acted on. */
function decide(request, yes) {
  const kind = KINDS[request.kind];
  if (!kind) return { done: false, line: SPENT };
  if (!kind.waiting(request.ref)) return { done: false, line: HANDLED };
  if (yes) kind.approve(request.ref);
  else kind.refuse(request.ref);
  debug.log("telegram: a %s request was %s from the chat", request.kind, yes ? "approved" : "refused");
  return { done: true, line: yes ? "승인했습니다" : kind.refused };
}

/**
 * Handles one callback_query. Resolves to what happened, for the tests:
 * "other-chat" | "not-allowed" | "spent" | "handled" | "approved" | "refused".
 */
export async function handleCallback(q, conf = integrations.get("telegram")) {
  const answer = (text) => alerts.callTelegram(conf.botToken, "answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => {});
  const chat = q?.message?.chat;
  if (!sameChat(chat, conf.chatId)) {
    await answer("이 대화에서는 처리할 수 없습니다");
    return "other-chat";
  }
  if (!mayDecide(conf, chat, q.from)) {
    await answer("승인할 수 있는 사용자로 등록되지 않았습니다");
    return "not-allowed";
  }
  const m = /^([yn]):(.+)$/.exec(String(q.data ?? ""));
  const request = m && approvalTokens.take(m[2]);
  if (!request) {
    await answer(SPENT);
    return "spent";
  }
  const yes = m[1] === "y";
  const { done, line } = decide(request, yes);
  await answer(line);
  const footer = done ? `${who(q.from)} 님이 ${line}.` : `${line}.`;
  await alerts.callTelegram(conf.botToken, "editMessageText", {
    chat_id: chat.id,
    message_id: q.message.message_id,
    text: `${q.message.text ?? ""}\n\n${footer}`.slice(0, 4096),
    disable_web_page_preview: true,
  }).catch((err) => debug.log("telegram: alert not rewritten: %s", err.message));
  if (!done) return "handled";
  return yes ? "approved" : "refused";
}
