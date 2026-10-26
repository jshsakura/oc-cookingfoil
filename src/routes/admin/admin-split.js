import { LIBRARY_HTML, LIBRARY_PAGE_SCRIPT } from "./library-page.js";
import { LIBRARY_FILES_SCRIPT } from "./library-files-panel.js";
import { LIB_BROWSER_CSS, LIB_BROWSER_SCRIPT } from "./library-browser-panel.js";
import { ORGANIZE_CSS, ORGANIZE_SCRIPT } from "./library-organize-panel.js";
import { PATCHES_SCRIPT } from "./patches-panel.js";
import { HOMEBREW_HTML, HOMEBREW_DIALOG_HTML, HOMEBREW_SCRIPT } from "./homebrew-page.js";
import { LIST_HELPERS_CSS, LIST_HELPERS_SCRIPT } from "./list-helpers.js";
import { CONTENT_EDITOR_SCRIPT } from "./content-editor.js";
import { CONTENT_DIALOG_HTML, PATCHES_CSS } from "./patches-panel.js";
import { OVERVIEW_HTML, OVERVIEW_SCRIPT } from "./overview-page.js";
import { UPLOAD_HTML, UPLOAD_SCRIPT } from "./upload-page.js";
import { GAME_PICKER_CSS, GAME_PICKER_SCRIPT } from "./game-picker.js";
import { GOOGLE_SETTINGS_HTML, ADMIN_SECURITY_HTML, ADMIN_SECURITY_SCRIPT } from "./security-pages.js";
import { GOOGLE_SETTINGS_SCRIPT } from "./google-settings-script.js";
import { FEATURED_HTML, FEATURED_SCRIPT } from "./featured-page.js";
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
import { ADMIN_TITLE_HTML, ASK_DIALOG_HTML, PAGE_CSS, adminChrome } from "./dashboard-page.js";
import { POLISH_CSS, POLISH_SCRIPT } from "./polish.js";
import { ACTIVITY_CSS, ACTIVITY_SCRIPT } from "./activity-panel.js";
import { BOX_CSS, BOX_SCRIPT } from "./boxes.js";
import { top, TOP_I18N_SCRIPT, TOP_LANG_CSS } from "./top-i18n.js";
import { NAV_CSS, NAV_SCRIPT } from "./nav-structure.js";
import { ADM_SHELL_CSS, admRouterScript } from "./admin-pages.js";
import { COMMON_SCRIPT } from "./common-script.js";
import { CHROME_SCRIPT } from "./chrome-script.js";
import { INBOX_CSS, INBOX_HTML, INBOX_SCRIPT } from "./inbox-panel.js";
import { NSZ_CSS, NSZ_HTML, NSZ_SCRIPT } from "./nsz-panel.js";
import { TRASH_CSS, TRASH_HTML, TRASH_SCRIPT } from "./trash-panel.js";
import { PLUGINS_CSS, PLUGINS_HTML, PLUGINS_SCRIPT } from "./plugins-panel.js";
import { TRANSFERS_CSS, TRANSFERS_HTML, TRANSFERS_SCRIPT } from "./transfers-panel.js";
import { LOGS_CLIENT_HTML, LOGS_CSS, LOGS_SCRIPT, LOGS_SECURITY_HTML } from "./logs-pages.js";
import { PEOPLE_SCRIPT } from "./people-script.js";
import { CRED_DIALOG_HTML, devicesHtml, IP_DIALOG_HTML, USERS_HTML } from "./people-pages.js";
import { ALERTS_CSS, ALERTS_SCRIPT, ALERTS_HTML } from "./alerts-panel.js";
import { SERVER_SETTINGS_CSS, SERVER_SETTINGS_HTML, SERVER_SETTINGS_SCRIPT } from "./server-settings-panel.js";
import { INTEGRATIONS_CSS, INTEGRATIONS_HTML, INTEGRATIONS_SCRIPT } from "./integrations-panel.js";
import { TOKENS_HTML, TOKENS_SCRIPT } from "./tokens-panel.js";
import { RETRO_ART_CSS, RETRO_ART_HTML, RETRO_ART_SCRIPT } from "./retro-art-panel.js";
import { CLIENT_RELEASE_HTML, CLIENT_RELEASE_SCRIPT } from "./client-release-panel.js";

/** One split page: its own styles, body and scripts around the shared shell. */
function splitPage(page, { css = "", body = "", script = "", init = "" }, view = "") {
  const current = { path: page.path, view };
  // The panel sections ship with `hidden` for the whole-page tab switching;
  // on a page of their own the one section is the page, so it opens.
  const markup = typeof body === 'function' ? body() : body;
  const open = markup.replace(/(<section id="tab-[a-z-]+") hidden>/, "$1>");
  return /* html */ `<!doctype html><html lang="ko" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${ADMIN_TITLE_HTML}${ADMIN_HEAD}${GRID_HEAD}<style>${ADMIN_CSS}${BRAND_MOTION_CSS}${PAGE_CSS}${POLISH_CSS}${ACTIVITY_CSS}${ICON_CSS}${BOX_CSS}${GRID_CSS}${css}${TOP_LANG_CSS}${NAV_CSS}${ADM_SHELL_CSS}</style></head>
<body class="adm-shell">
${adminChrome(current)}
<div class="wrap">
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
  "/admin/games": bundle({
    css: LIST_HELPERS_CSS+PATCHES_CSS+GAME_PICKER_CSS+LIB_BROWSER_CSS+ORGANIZE_CSS,
    body: LIBRARY_HTML+CONTENT_DIALOG_HTML,
    script: GAME_PICKER_SCRIPT+LIST_HELPERS_SCRIPT+LIBRARY_PAGE_SCRIPT+PATCHES_SCRIPT+LIBRARY_FILES_SCRIPT+LIB_BROWSER_SCRIPT+ORGANIZE_SCRIPT,
    init: "libShowSub(location.hash.split('/')[1]||'files',true);loadLibrary();",
  }),
  "/admin/homebrew": bundle({
    css: LIST_HELPERS_CSS+PATCHES_CSS+GAME_PICKER_CSS,
    body: HOMEBREW_HTML+HOMEBREW_DIALOG_HTML+CONTENT_DIALOG_HTML,
    script: GAME_PICKER_SCRIPT+LIST_HELPERS_SCRIPT+HOMEBREW_SCRIPT+CONTENT_EDITOR_SCRIPT,
    init: "subtabs('homebrew');SUBTABS.homebrew.show(location.hash.split('/')[1]||'apps');loadHomebrew();",
  }),
  "/admin": bundle({ body: OVERVIEW_HTML, script: OVERVIEW_SCRIPT, init: "admInterval(loadOverview,15000);" }),
  "/admin/upload": bundle({ css: GAME_PICKER_CSS, body: UPLOAD_HTML, script: GAME_PICKER_SCRIPT+UPLOAD_SCRIPT, init: "loadUpload();" }),
  "/admin/settings/login": bundle({ body: '<section id="tab-settings">'+GOOGLE_SETTINGS_HTML+'</section>', script: GOOGLE_SETTINGS_SCRIPT, init: "loadGoogleSettings();" }),
  "/admin/settings/admin": bundle({ body: '<section id="tab-settings">'+ADMIN_SECURITY_HTML+'</section>', script: ADMIN_SECURITY_SCRIPT, init: "loadTfa();" }),
  "/admin/featured": bundle({ body: FEATURED_HTML, script: FEATURED_SCRIPT, init: "loadFeatured();" }),
  "/admin/settings/plugins": bundle({ css: PLUGINS_CSS, body: PLUGINS_HTML, script: PLUGINS_SCRIPT, init: "loadPlugins();" }),
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
  // Third bundle: the pages whose panels were already modules of their own.
  "/admin/notifications": bundle({
    css: ALERTS_CSS, body: ALERTS_HTML, script: ALERTS_SCRIPT,
    init: "subtabs('alerts');SUBTABS.alerts.show(location.hash.split('/')[1]||'setup');loadAlerts();",
  }),
  "/admin/client": bundle({
    body: `<section id="tab-client"><div class="hd"><h2 class="first">${top("m.client")}</h2></div>${CLIENT_RELEASE_HTML}</section>`,
    script: CLIENT_RELEASE_SCRIPT,
    init: "loadClientRelease();",
  }),
  // Settings pages: each area is its own page now.
  "/admin/settings/server": bundle({
    css: SERVER_SETTINGS_CSS, body: SERVER_SETTINGS_HTML,
    script: SERVER_SETTINGS_SCRIPT, init: "loadServerSettings();",
  }),
  "/admin/settings/integrations": bundle({
    css: INTEGRATIONS_CSS, body: INTEGRATIONS_HTML,
    script: INTEGRATIONS_SCRIPT, init: "loadIntegrations();",
  }),
  "/admin/settings/automation": bundle({
    body: TOKENS_HTML,
    script: TOKENS_SCRIPT, init: "loadTokens();loadMcp();",
  }),
  // The retro games page: all eight sub-views in one section with their own subtabs.
  "/admin/retro": bundle({
    css: RETRO_ART_CSS, body: RETRO_ART_HTML, script: RETRO_ART_SCRIPT,
    init: "setTimeout(retroOpen,0);",
  }),
  // Second bundle: the people pages carry their own credential and IP dialogs.
  "/admin/users": bundle({
    body: USERS_HTML + CRED_DIALOG_HTML + IP_DIALOG_HTML, script: PEOPLE_SCRIPT,
    init: "admInterval(loadPeople,15000);",
  }),
  "/admin/devices": bundle({
    body: () => devicesHtml() + IP_DIALOG_HTML, script: PEOPLE_SCRIPT,
    init: "admInterval(loadPeople,15000);",
  }),
};

/** The rendered page, or null when the path is not one of the split ones. */
export function splitPageFor(page, view = "") {
  const extra = SPLIT_PAGES[page.path];
  return extra ? splitPage(page, extra, view) : null;
}
