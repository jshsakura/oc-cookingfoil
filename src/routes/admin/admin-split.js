/**
 * The split pages of the admin redesign (Stage B, first bundle): trash, inbox,
 * NSZ conversion and the three records pages. Each page carries only its own
 * markup, styles and script around the shared shell (sidebar, header, ask
 * dialog, activity menu, the path bridge), loads its own data, and its polls
 * run through admInterval so a hidden tab or a left page stops asking.
 *
 * The still-whole dashboard keeps serving the pages not split yet; it inlines
 * the same panel modules, so each behaviour has one owner.
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { BRAND_MOTION_CSS } from "../../views/brand-motion.js";
import { ICON_CSS } from "../../views/icons.js";
import { GRID_CSS, GRID_HEAD, GRID_SCRIPT } from "./grid.js";
import { ADMIN_HEADER_HTML, ADMIN_TITLE_HTML, ASK_DIALOG_HTML, PAGE_CSS, adminChrome } from "./dashboard-page.js";
import { POLISH_CSS, POLISH_SCRIPT } from "./polish.js";
import { ACTIVITY_CSS, ACTIVITY_SCRIPT } from "./activity-panel.js";
import { BOX_CSS, BOX_SCRIPT } from "./boxes.js";
import { TOP_I18N_SCRIPT, TOP_LANG_CSS } from "./top-i18n.js";
import { NAV_CSS, NAV_SCRIPT } from "./nav-structure.js";
import { ADM_SHELL_CSS, admRouterScript } from "./admin-pages.js";
import { COMMON_SCRIPT } from "./common-script.js";
import { CHROME_SCRIPT } from "./chrome-script.js";
import { INBOX_CSS, INBOX_HTML, INBOX_SCRIPT } from "./inbox-panel.js";
import { NSZ_CSS, NSZ_HTML, NSZ_SCRIPT } from "./nsz-panel.js";
import { TRASH_CSS, TRASH_HTML, TRASH_SCRIPT } from "./trash-panel.js";
import { TRANSFERS_CSS, TRANSFERS_HTML, TRANSFERS_SCRIPT } from "./transfers-panel.js";
import { LOGS_CLIENT_HTML, LOGS_CSS, LOGS_SCRIPT, LOGS_SECURITY_HTML } from "./logs-pages.js";
import { PEOPLE_SCRIPT } from "./people-script.js";
import { CRED_DIALOG_HTML, DEVICES_HTML, IP_DIALOG_HTML, USERS_HTML } from "./people-pages.js";

/** One split page: its own styles, body and scripts around the shared shell. */
function splitPage(page, { css = "", body = "", script = "", init = "" }) {
  const current = { path: page.path, view: "" };
  // The panel sections ship with `hidden` for the whole-page tab switching;
  // on a page of their own the one section is the page, so it opens.
  const open = body.replace(/(<section id="tab-[a-z-]+") hidden>/, "$1>");
  return /* html */ `<!doctype html><html lang="ko" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${ADMIN_TITLE_HTML}${ADMIN_HEAD}${GRID_HEAD}<style>${ADMIN_CSS}${BRAND_MOTION_CSS}${PAGE_CSS}${POLISH_CSS}${ACTIVITY_CSS}${ICON_CSS}${BOX_CSS}${GRID_CSS}${css}${TOP_LANG_CSS}${NAV_CSS}${ADM_SHELL_CSS}</style></head>
<body class="adm-shell">
${adminChrome(current)}
<div class="wrap">
${ADMIN_HEADER_HTML}
<main>
${open}
</main>
</div>
${ASK_DIALOG_HTML}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${admRouterScript(page)}${TOP_I18N_SCRIPT}${GRID_SCRIPT}${COMMON_SCRIPT}${CHROME_SCRIPT}${script}${ACTIVITY_SCRIPT}${POLISH_SCRIPT}${BOX_SCRIPT}${NAV_SCRIPT}${init}</script></body></html>`;
}

const bundle = (extra) => extra;

/** The first bundle's pages, by the path the router already knows. */
export const SPLIT_PAGES = {
  "/admin/trash": bundle({ css: TRASH_CSS, body: TRASH_HTML, script: TRASH_SCRIPT, init: "loadTrash();" }),
  "/admin/inbox": bundle({ css: INBOX_CSS, body: INBOX_HTML, script: INBOX_SCRIPT, init: "loadInbox();" }),
  "/admin/convert": bundle({ css: NSZ_CSS, body: NSZ_HTML, script: NSZ_SCRIPT, init: "loadNsz();" }),
  "/admin/logs/downloads": bundle({ css: TRANSFERS_CSS + LOGS_CSS, body: TRANSFERS_HTML, script: TRANSFERS_SCRIPT, init: "setTimeout(xfOpen);" }),
  "/admin/logs/clients": bundle({
    css: LOGS_CSS, body: LOGS_CLIENT_HTML, script: LOGS_SCRIPT,
    init: "admInterval(loadClientLogs,30000);",
  }),
  "/admin/logs/security": bundle({
    css: LOGS_CSS, body: LOGS_SECURITY_HTML, script: LOGS_SCRIPT,
    init: "admInterval(loadSecurity,15000);",
  }),
  // Second bundle: the people pages carry their own credential and IP dialogs.
  "/admin/users": bundle({
    body: USERS_HTML + CRED_DIALOG_HTML + IP_DIALOG_HTML, script: PEOPLE_SCRIPT,
    init: "admInterval(loadPeople,15000);",
  }),
  "/admin/devices": bundle({
    body: DEVICES_HTML + IP_DIALOG_HTML, script: PEOPLE_SCRIPT,
    init: "admInterval(loadPeople,15000);",
  }),
};

/** The rendered page, or null when the path is not one of the split ones. */
export function splitPageFor(page) {
  const extra = SPLIT_PAGES[page.path];
  return extra ? splitPage(page, extra) : null;
}
