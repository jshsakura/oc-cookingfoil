/**
 * The admin's people pages: the accounts and devices sections, and the
 * one-time credential and IP dialogs they carry. Exported here so the split
 * pages and the whole-page dashboard share the same markup.
 */
import { icon } from "../../views/icons.js";
import { top, topN, TOP_WORDS } from "./top-i18n.js";
import { box } from "./boxes.js";
import { enrollPerHour } from "../../helpers/envs.js";

/** The accounts section: local accounts plus Google sign-in approval. */
export const USERS_HTML = /* html */ `<section id="tab-users" hidden>
  <div class="subtabs hide-bar" id="users-subtabs" role="tablist" aria-label="Users area">
    <button type="button" role="tab" data-sub="local" aria-selected="true">${icon("users")}${top("pp.localAccounts")}</button>
    <button type="button" role="tab" data-sub="google" aria-selected="false">${icon("lock")}${top("pp.googleAccounts")}<span class="count" id="account-sub-count" hidden></span></button>
  </div>
  <div data-sub-panel="local">
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" placeholder="Username (letters, numbers, . _ -)" aria-label="Username" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" placeholder="Password (leave blank to auto-generate)" aria-label="Password" maxlength="128">
    <select id="new-role" aria-label="Role"><option value="user">${top("pp.user")}</option><option value="admin">${top("pp.admin")}</option></select>
    <button class="primary" type="submit">${top("pp.addUser")}</button>
  </form>
  <div class="scroll" id="users" data-skel></div>
  ${box("users-help", `${TOP_WORDS.ko["pp.usersHelpTitle"]}`, `<p class="muted">${TOP_WORDS.ko["pp.usersHelpBody"]}</p>`, { level: "h3" })}
  </div>
  <div data-sub-panel="google" hidden>
  <p class="muted" id="accounthint"></p>
  <div class="scroll" id="accounts" data-skel></div>
  </div>
</section>`;

/** The devices section: pending, approved and issued-clients areas. */
export function devicesHtml() { return /* html */ `<section id="tab-devices" hidden>
  <div class="subtabs hide-bar" id="devices-subtabs" role="tablist" aria-label="Devices area">
    <button type="button" role="tab" data-sub="pending" aria-selected="true">${icon("bell")}${top("pp.devWait")}<span class="count" id="pending-sub-count" hidden></span></button>
    <button type="button" role="tab" data-sub="approved" aria-selected="false">${icon("device")}${top("pp.devApproved")} </button>
    <button type="button" role="tab" data-sub="clients" aria-selected="false">${icon("download")}${top("pp.issuedClients")} </button>
  </div>
  <div data-sub-panel="pending">
  <p class="muted" id="devhint"></p>
  <form class="add" id="approve-code">
    <input id="code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" data-top-ph="pp.devCodePh" placeholder="Device code from the console screen (8 chars)" aria-label="Device code" required maxlength="9">
    <input id="code-label" autocomplete="off" placeholder="Device name (optional)" aria-label="Device name" maxlength="64">
    <button class="primary" type="submit">${top("pp.approveByCode")}</button>
  </form>
  <div class="scroll" id="pending" data-skel></div>
  </div>
  <div data-sub-panel="approved" hidden>
  <div class="add"><select id="dev-idle" data-top-label="acc.filter" aria-label="${TOP_WORDS.ko["acc.filter"]}">${["filterAll", "idle30", "idle60", "idle90"].map((k, i) =>
    `<option value="${i * 30}" data-top="acc.${k}">${TOP_WORDS.ko[`acc.${k}`]}</option>`).join("")}</select></div>
  <p class="muted">${top("acc.filterHint")}</p>
  <div class="scroll" id="devices" data-skel></div>
  </div>
  <div data-sub-panel="clients" hidden>
  <p class="muted">${topN("dev.clientsLead", enrollPerHour)}</p>
  <div class="scroll" id="clients" data-skel></div>
  <details class="ended-box" id="clients-ended-box" hidden><summary>${top("pp.endedItems")} (<span id="clients-ended-count">0</span>)</summary><div class="scroll" id="clients-ended" data-skel></div></details>
  </div>
</section>`; }

/** The one-time credential dialog: a new password shows once, then it is gone. */
export const CRED_DIALOG_HTML = /* html */ `<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted">${top("pp.credLead")}</p>
  <div class="cred" id="cred"></div>
  <p class="muted">${top("pp.credConfig")}</p>
  <div class="dialog-actions">
    <button type="button" id="cred-config">${top("pp.credDownload")}</button>
    <button type="button" class="primary" id="cred-close">${top("acc.close")}</button>
  </div>
</dialog>`;

/** The IP history dialog: where a console or an account connected from. */
export const IP_DIALOG_HTML = /* html */ `<dialog id="ip-dialog" aria-labelledby="ip-title">
  <h3 id="ip-title"></h3>
  <p class="muted" id="ip-hint"></p>
  <div class="ip-list" id="ip-list"></div>
  <div class="dialog-actions"><button type="button" class="primary" id="ip-close" data-top="acc.close"></button></div>
</dialog>`;
