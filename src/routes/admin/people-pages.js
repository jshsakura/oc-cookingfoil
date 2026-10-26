/**
 * The admin's people pages: the accounts and devices sections, and the
 * one-time credential and IP dialogs they carry. Exported here so the split
 * pages and the whole-page dashboard share the same markup.
 *
 * Every human string here is wired to the dictionary: data-top for text
 * (including <option>s, which must carry it themselves), data-top-ph for
 * placeholders and data-top-label for aria-labels, each with the Korean
 * value baked in so the page reads Korean before the language script runs
 * and retranslates when it does. The device tabs carry their own keys so
 * the tab names keep their screen meaning apart from the status words.
 */
import { icon } from "../../views/icons.js";
import { TOP_WORDS } from "./top-i18n.js";
import { box } from "./boxes.js";
import { connectHowto } from "./connect-howto.js";
import { enrollPerHour } from "../../helpers/envs.js";

const ko = (key) => `${TOP_WORDS.ko[key]}`;

/** The accounts section: local accounts plus Google sign-in approval. */
export const USERS_HTML = /* html */ `<section id="tab-users" hidden>
  <div class="subtabs hide-bar" id="users-subtabs" role="tablist" data-top-label="pp.usersArea" aria-label="${ko("pp.usersArea")}">
    <button type="button" role="tab" data-sub="local" aria-selected="true">${icon("users")}<span data-top="pp.localAccounts">${ko("pp.localAccounts")}</span></button>
    <button type="button" role="tab" data-sub="google" aria-selected="false">${icon("lock")}<span data-top="pp.googleAccounts">${ko("pp.googleAccounts")}</span><span class="count" id="account-sub-count" hidden></span></button>
  </div>
  <div data-sub-panel="local">
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" data-top-ph="pp.userNamePh" placeholder="${ko("pp.userNamePh")}" data-top-label="pp.userNameLabel" aria-label="${ko("pp.userNameLabel")}" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" data-top-ph="pp.passPh" placeholder="${ko("pp.passPh")}" data-top-label="pp.passLabel" aria-label="${ko("pp.passLabel")}" maxlength="128">
    <select id="new-role" data-top-label="pp.role" aria-label="${ko("pp.role")}"><option value="user" data-top="pp.user">${ko("pp.user")}</option><option value="admin" data-top="pp.admin">${ko("pp.admin")}</option></select>
    <button class="primary" type="submit" data-top="pp.addUser">${ko("pp.addUser")}</button>
  </form>
  <div class="scroll" id="users" data-skel></div>
  ${box("users-help", `<span data-top="pp.usersHelpTitle">${ko("pp.usersHelpTitle")}</span>`, `<p class="muted" data-top="pp.usersHelpBody">${ko("pp.usersHelpBody")}</p>`, { level: "h3" })}
  </div>
  <div data-sub-panel="google" hidden>
  <p class="muted" id="accounthint"></p>
  <div class="scroll" id="accounts" data-skel></div>
  </div>
</section>`;

/** The devices section: pending, approved and issued-clients areas. */
export function devicesHtml() { return /* html */ `<section id="tab-devices" hidden>
  <div class="subtabs hide-bar" id="devices-subtabs" role="tablist" data-top-label="pp.devicesArea" aria-label="${ko("pp.devicesArea")}">
    <button type="button" role="tab" data-sub="pending" aria-selected="true">${icon("bell")}<span data-top="pp.tabPending">${ko("pp.tabPending")}</span><span class="count" id="pending-sub-count" hidden></span></button>
    <button type="button" role="tab" data-sub="approved" aria-selected="false">${icon("device")}<span data-top="pp.tabApproved">${ko("pp.tabApproved")}</span></button>
    <button type="button" role="tab" data-sub="clients" aria-selected="false">${icon("download")}<span data-top="pp.tabClients">${ko("pp.tabClients")}</span></button>
  </div>
  ${box("connect-howto", `<span data-top="ov.howtoH">${ko("ov.howtoH")}</span>`, `<ul class="howto-list">${connectHowto().map((line) => `<li>${line}</li>`).join("")}</ul>`, { level: "h3", folded: true })}
  <div data-sub-panel="pending">
  <p class="muted" id="devhint"></p>
  <form class="add" id="approve-code">
    <input id="code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" data-top-ph="pp.devCodePh" placeholder="${ko("pp.devCodePh")}" data-top-label="pp.devCodeLabel" aria-label="${ko("pp.devCodeLabel")}" required maxlength="9">
    <input id="code-label" autocomplete="off" data-top-ph="pp.devNameOpt" placeholder="${ko("pp.devNameOpt")}" data-top-label="pp.devNameLabel" aria-label="${ko("pp.devNameLabel")}" maxlength="64">
    <button class="primary" type="submit" data-top="pp.approveByCode">${ko("pp.approveByCode")}</button>
  </form>
  <div class="scroll" id="pending" data-skel></div>
  </div>
  <div data-sub-panel="approved" hidden>
  <div class="add"><select id="dev-idle" data-top-label="acc.filter" aria-label="${ko("acc.filter")}">${["filterAll", "idle30", "idle60", "idle90"].map((k, i) =>
    `<option value="${i * 30}" data-top="acc.${k}">${TOP_WORDS.ko[`acc.${k}`]}</option>`).join("")}</select></div>
  <p class="muted" data-top="acc.filterHint">${ko("acc.filterHint")}</p>
  <div class="scroll" id="devices" data-skel></div>
  </div>
  <div data-sub-panel="clients" hidden>
  <p class="muted" data-top="dev.clientsLead" data-top-n="${enrollPerHour}">${TOP_WORDS.ko["dev.clientsLead"].split("{n}").join(enrollPerHour)}</p>
  <div class="scroll" id="clients" data-skel></div>
  <details class="ended-box" id="clients-ended-box" hidden><summary><span data-top="pp.endedItems">${ko("pp.endedItems")}</span> (<span id="clients-ended-count">0</span>)</summary><div class="scroll" id="clients-ended" data-skel></div></details>
  </div>
</section>`; }

/** The one-time credential dialog: a new password shows once, then it is gone. */
export const CRED_DIALOG_HTML = /* html */ `<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted" data-top="pp.credLead">${ko("pp.credLead")}</p>
  <div class="cred" id="cred"></div>
  <p class="muted" data-top="pp.credConfig">${ko("pp.credConfig")}</p>
  <div class="dialog-actions">
    <button type="button" id="cred-config" data-top="pp.credDownload">${ko("pp.credDownload")}</button>
    <button type="button" class="primary" id="cred-close" data-top="acc.close">${ko("acc.close")}</button>
  </div>
</dialog>`;

/** The IP history dialog: where a console or an account connected from. */
export const IP_DIALOG_HTML = /* html */ `<dialog id="ip-dialog" aria-labelledby="ip-title">
  <h3 id="ip-title"></h3>
  <p class="muted" id="ip-hint"></p>
  <div class="ip-list" id="ip-list"></div>
  <div class="dialog-actions"><button type="button" class="primary" id="ip-close" data-top="acc.close">${ko("acc.close")}</button></div>
</dialog>`;
