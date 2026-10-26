import { LIBRARY_HTML } from "./library-page.js";
import { LIST_HELPERS_CSS } from "./list-helpers.js";
import { HOMEBREW_HTML, HOMEBREW_DIALOG_HTML } from "./homebrew-page.js";
import { OVERVIEW_CSS, OVERVIEW_HTML } from "./overview-page.js";
import { UPLOAD_HTML } from "./upload-page.js";
import { GOOGLE_SETTINGS_HTML, ADMIN_SECURITY_HTML } from "./security-pages.js";
import { FEATURED_HTML } from "./featured-page.js";
/**
 * The operator dashboard.
 *
 * Its job, in order of importance:
 *   1. say out loud when the current auth configuration leaves the server
 *      open or locks out a client the operator thinks should work
 *   2. manage who can connect: accounts, devices, lockouts
 *   3. show every refusal the server made, with the reason
 *   4. keep the library healthy without shell access
 */
import { ADMIN_CSS, ADMIN_HEAD } from "./styles.js";
import { BRAND_MOTION_CSS } from "../../views/brand-motion.js";
import { DASHBOARD_SCRIPT } from "./dashboard-script.js";
import { ICON_CSS, icon } from "../../views/icons.js";
import { INTEGRATIONS_CSS, INTEGRATIONS_HTML, INTEGRATIONS_SCRIPT } from "./integrations-panel.js";
import { RETRO_ART_CSS, RETRO_ART_HTML, RETRO_ART_SCRIPT } from "./retro-art-panel.js";
import { ALERTS_CSS, ALERTS_HTML, ALERTS_SCRIPT } from "./alerts-panel.js";
import { SERVER_SETTINGS_CSS, SERVER_SETTINGS_HTML, SERVER_SETTINGS_SCRIPT } from "./server-settings-panel.js";
import { LIBRARY_FILES_SCRIPT } from "./library-files-panel.js";
import { LIB_BROWSER_CSS, LIB_BROWSER_SCRIPT } from "./library-browser-panel.js";
import { ORGANIZE_CSS, ORGANIZE_SCRIPT } from "./library-organize-panel.js";
import { CONTENT_DIALOG_HTML, PATCHES_CSS, PATCHES_SCRIPT } from "./patches-panel.js";
import { TOKENS_HTML, TOKENS_SCRIPT } from "./tokens-panel.js";
import { INBOX_CSS, INBOX_HTML, INBOX_SCRIPT } from "./inbox-panel.js";
import { NSZ_CSS, NSZ_HTML, NSZ_SCRIPT } from "./nsz-panel.js";
import { TRASH_CSS, TRASH_HTML, TRASH_SCRIPT } from "./trash-panel.js";
import { TRANSFERS_CSS, TRANSFERS_HTML, TRANSFERS_SCRIPT } from "./transfers-panel.js";
import { LOGS_CLIENT_HTML, LOGS_CSS, LOGS_SECURITY_HTML } from "./logs-pages.js";
import { POLISH_CSS, POLISH_SCRIPT } from "./polish.js";
import { NAV_CSS, NAV_SCRIPT } from "./nav-structure.js";
import { ADMIN_PAGE_BY_PATH, ADM_SHELL_CSS, MENU_BUTTON_HTML, admRouterScript, drawerHtml, sidebarNav } from "./admin-pages.js";
import { ACTIVITY_CSS, ACTIVITY_HTML, ACTIVITY_BUTTON_HTML, ACTIVITY_SCRIPT } from "./activity-panel.js";
import { BOX_CSS, BOX_SCRIPT } from "./boxes.js";
import { TOP_I18N_SCRIPT, TOP_LANG_CSS, TOP_LANG_HTML, top } from "./top-i18n.js";
import { GRID_CSS, GRID_HEAD, GRID_SCRIPT } from "./grid.js";
import { USERS_HTML, devicesHtml, CRED_DIALOG_HTML, IP_DIALOG_HTML } from "./people-pages.js";
import { GAME_PICKER_CSS, GAME_PICKER_SCRIPT } from "./game-picker.js";

export const PAGE_CSS = /* css */ `
${BRAND_MOTION_CSS}
body{padding:28px 32px 80px}.wrap{max-width:1240px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.brand{margin:0}.brand a{display:flex;align-items:center;gap:12px;color:var(--text);text-decoration:none}
.logo{width:44px;height:44px;flex:none}
.brand .wm{font-family:'Baloo 2',inherit;font-size:var(--fs-3xl);font-weight:var(--fw-bold);letter-spacing:-.02em;line-height:1;padding-top:4px}.brand .wm .dot{color:var(--accent)}
/* the dashboard's view switch, so the admin page reads as its third tab */
.apptabs{display:inline-flex;gap:2px;padding:3px;margin-right:auto;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--panel)}
.apptabs a{padding:6px 14px;border-radius:var(--r-pill);color:var(--muted);text-decoration:none;font-weight:var(--fw-bold);font-size:var(--fs-sm);white-space:nowrap}
.apptabs a:hover{color:var(--text)}.apptabs a[aria-current="page"]{background:var(--text);color:var(--bg)}
.tfa{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:18px 20px;margin-bottom:22px}
.tfa .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tfa-setup{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}.tfa-setup[hidden]{display:none}
.tfa-qr{width:180px;height:180px;background:var(--white);border-radius:var(--r-lg);padding:6px}.tfa-qr svg{width:100%;height:100%;display:block}
.tfa-key{font-family:ui-monospace,monospace;font-size:var(--fs-md);letter-spacing:1px;word-break:break-all;background:var(--sunk);border-radius:var(--r-md);padding:10px 12px}
@media(max-width:640px){.tfa-setup{grid-template-columns:1fr}}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--panel)}
.seg button{border:none;border-radius:var(--r-pill);padding:6px 10px;color:var(--muted)}
.seg button.active{background:var(--text);color:var(--bg)}
.seg svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* The old two-row menu (nav.tabs + .group-tabs) is gone; the sidebar in admin-pages.js owns the tree. */
.count[hidden]{display:none}
.count{display:inline-block;min-width:18px;padding:0 6px;margin-left:6px;border-radius:var(--r-pill);font-size:var(--fs-2xs);background:rgba(var(--bad-rgb),.18);color:var(--bad)}
section[hidden]{display:none}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:18px 20px}
.card .v{font-size:var(--fs-3xl);font-weight:var(--fw-bold);letter-spacing:-.02em}
.card .l{color:var(--muted);font-size:var(--fs-xs)}
.card.alert{border-color:rgba(var(--bad-rgb),.45)}.card.alert .v{color:var(--bad)}
.lanes{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}
.scroll{overflow-x:auto}
.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.hd{margin:24px 0 10px}.hd:first-child{margin-top:0}.hd h2,.hd h2.first{margin:0}
form.add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:14px;margin-bottom:16px}
form.add input{flex:1;min-width:150px}
form.add label.toggle{flex-basis:100%;display:flex;align-items:center;gap:8px;font-weight:var(--fw-bold)}
form.add label.toggle input{flex:none;min-width:0;width:18px;height:18px}
.copy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.copy-row[hidden],.add[hidden]{display:none}
/* One account menu, the same as the web page's: a circle that opens who you are, the web page, the guide and sign out. */
.acct-menu{position:relative}
.icon-btn{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}
.icon-btn:hover,.icon-btn[aria-expanded="true"]{border-color:var(--text)}.icon-btn .ico{width:19px;height:19px}
.pop-list{position:absolute;right:0;top:calc(100% + 6px);z-index:60;min-width:210px;padding:6px;display:grid;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);box-shadow:0 16px 36px var(--shadow)}
.pop-list[hidden]{display:none}
/* The signed-in account as a plain label: phones must not turn an email address into a mail link. */
.pop-list a,.pop-list button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;padding:9px 12px;border:0;border-radius:var(--r-md);background:none;text-decoration:none;color:var(--text);font:600 14px inherit;text-align:left;cursor:pointer}
.pop-list a:hover,.pop-list button:hover{background:var(--sunk)}.pop-list #logout{color:var(--bad)}
/* theme: one row with a switch; on means dark */
.pop-list .menu-sep{height:1px;margin:4px 6px;background:var(--line)}
.howto-list{margin:0;padding-left:20px;display:grid;gap:6px;font-size:var(--fs-md);line-height:1.6}
#tab-overview>.copy-row{margin-bottom:12px}
.copy-row code{flex:1;min-width:0;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px;font-size:var(--fs-sm);user-select:all}
.up-kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.up-kinds button{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:3px;text-align:left;padding:12px 14px;border-radius:var(--r-xl)}
.up-kinds button span{font-size:var(--fs-xs);font-weight:400;color:var(--muted)}
#up-form [hidden]{display:none!important}
.up-group{margin:4px 0 8px;font-size:var(--fs-xs);font-weight:700;color:var(--muted)}
/* Retro consoles as small tiles; once one is picked the rest fold away behind "다른 기종". */
.up-systems{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}.up-systems[data-skel]:empty{min-height:120px}
.up-systems button{flex-direction:row;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--r-lg);min-height:42px}
.up-systems button img{width:22px;height:22px;object-fit:contain;flex:none}
.up-systems button b{min-width:0;font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.up-systems.folded button[data-system][aria-pressed="false"]{display:none}
.up-systems .up-more-sys{justify-content:center;color:var(--muted);font-weight:700}
.up-kinds button[aria-pressed="true"] span{color:inherit;opacity:.75}
.up-hint{margin:0 0 12px;min-height:1.4em}.up-hint:empty{display:none}
.up-lead{margin:0 0 12px}
.up-guess{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
.up-guess p{margin:0;flex:1 1 220px;font-size:var(--fs-md)}.up-guess.warn{border-color:var(--accent)}
.up-guess[hidden],#up-kinds[hidden],#up-systems-wrap[hidden]{display:none}
.up-systems.cands button[data-system]:not(.cand){display:none}
.up-plan{margin:0;font-size:var(--fs-sm);color:var(--muted)}.up-plan:empty{display:none}
.up-sum{margin:14px 0 0;font-weight:700;font-size:var(--fs-md)}.up-sum[hidden]{display:none}
.up-drop{display:grid;justify-items:center;gap:8px;text-align:center;padding:34px 20px;margin-bottom:14px;border:2px dashed var(--line);border-radius:var(--r-2xl);background:var(--panel);cursor:pointer;transition:border-color .15s,background .15s}
.up-drop:hover,.up-drop:focus-visible,.up-drop.over{border-color:var(--accent);background:rgba(var(--accent-rgb),.08);outline:none}
.up-drop svg{width:40px;height:40px;fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.up-drop b{font-size:var(--fs-lg)}.up-drop span{color:var(--muted);font-size:var(--fs-sm);max-width:520px;word-break:break-word}
.up-drop.has span{color:var(--text);font-weight:var(--fw-bold)}
.up-drop .pick{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.up-go{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ended-box{margin-top:12px}.ended-box summary{cursor:pointer;color:var(--muted);font-size:var(--fs-sm);font-weight:var(--fw-bold);margin-bottom:8px}
.up-more summary{cursor:pointer;color:var(--muted);font-size:var(--fs-sm);font-weight:var(--fw-bold)}
.up-more[open]{display:grid;gap:12px}.up-more[hidden]{display:none}
.up-more label{display:grid;gap:6px;font-size:var(--fs-sm);color:var(--muted);font-weight:var(--fw-bold)}
.up-foot{margin-top:12px}
body.dragging #tab-upload .up-drop{border-color:var(--accent)}
.up-kinds button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
form.up{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:16px}
form.up[hidden]{display:none}
form.up label{display:grid;gap:6px;font-size:var(--fs-sm);color:var(--muted);font-weight:var(--fw-bold)}
form.up label[hidden]{display:none}
form.up label.check,:is(td,.gc) label.check{display:flex;gap:8px;align-items:center;color:var(--text)}
form.up textarea{padding:10px 14px;border-radius:var(--r-lg);border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:var(--fs-md);min-height:72px;resize:vertical}
.bar{height:8px;border-radius:var(--r-sm);background:var(--sunk);overflow:hidden}
.bar>i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.up-log{display:grid;gap:6px;margin-top:14px}
:is(td,.gc) .row-actions{display:flex;gap:6px;flex-wrap:wrap}
/* On a wide screen the buttons sit side by side and the column is as wide as they are. */
@media (min-width:641px){td:has(>.row-actions){width:1%;white-space:nowrap}:is(td,.gc)>.row-actions{flex-wrap:nowrap}}
button.ib svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* The recommended version: a small star, filled on the one already picked. */
button.ib.picked{color:var(--accent);opacity:1}button.ib.picked svg{fill:currentColor}
/* Registered GitHub repositories as cards: facts in the middle, the buttons in the footer. */
.src-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:12px;margin:0 0 20px}
.src-card{display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:14px 16px}
.src-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.src-head a{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-ver{flex:none;font-size:var(--fs-xs);font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.src-desc{margin:0;color:var(--muted);font-size:var(--fs-sm);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.src-facts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin:0}
.src-facts dt{font-size:var(--fs-2xs);color:var(--muted);margin-bottom:3px}.src-facts dd{margin:0;font-size:var(--fs-sm);min-width:0}
.src-facts select{width:100%}
.src-state{display:grid;gap:6px;font-size:var(--fs-xs)}
.src-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
.src-foot select{width:auto}.src-foot .danger{margin-left:auto}
@media (min-width:641px){:is(td,.gc) button.ib{width:36px;height:36px;padding:0;position:relative}
  :is(td,.gc) button.ib>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
:is(td,.gc) .pills{display:flex;flex-wrap:wrap;gap:6px}
:is(td,.gc) .xline{display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:var(--fs-sm)}:is(td,.gc) .xline>span{flex:1;min-width:0}
:is(td,.gc).dim{color:var(--faint)}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:18px}
dl.kv dt{color:var(--muted);font-size:var(--fs-sm)}dl.kv dd{margin:0;font-size:var(--fs-sm);word-break:break-all}
dialog{--dlg-pad:24px;border:1px solid var(--line2);border-radius:var(--r-2xl);background:var(--panel);color:var(--text);padding:var(--dlg-pad);width:min(520px,calc(100vw - 32px));box-shadow:0 30px 60px var(--shadow)}
dialog::backdrop{background:rgba(0,0,0,.55)}
dialog.ask{width:min(420px,calc(100vw - 32px))}dialog.ask input{width:100%;box-sizing:border-box;margin:0 0 14px}dialog.ask p{margin:2px 0 14px;font-size:var(--fs-md);line-height:1.55;overflow-wrap:anywhere}
button.danger-solid{background:var(--bad);border-color:var(--bad);color:var(--white);font-weight:700}button.danger-solid:hover{filter:brightness(1.06);border-color:var(--bad)}
.hb-verify{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px 0 9px;border-radius:var(--r-pill);border:1px dashed var(--line);background:transparent;color:var(--faint);font:inherit;font-size:var(--fs-xs);font-weight:700;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s,box-shadow .15s}
.tfa-warn{color:var(--bad)!important;font-weight:var(--fw-bold)}
.tfa-ok{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-bottom:14px;border-radius:var(--r-xl);border:1px solid rgba(var(--good-rgb),.45);background:rgba(var(--good-rgb),.12)}
.tfa-ok svg{flex:none;width:30px;height:30px;fill:none;stroke:var(--good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tfa-ok b{display:block;color:var(--good);font-size:var(--fs-md)}.tfa-ok span{display:block;color:var(--muted);font-size:var(--fs-xs);margin-top:2px}
.hb-verify svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hb-verify:hover{border-color:rgba(var(--good-rgb),.6);color:var(--good)}
.hb-verify[aria-pressed=true]{border:1px solid rgba(var(--good-rgb),.5);background:rgba(var(--good-rgb),.14);color:var(--good);box-shadow:inset 0 0 0 1px rgba(var(--good-rgb),.08)}
.hb-verify[aria-pressed=true] svg{fill:rgba(var(--good-rgb),.22)}
.hb-verify:disabled{opacity:.6;cursor:progress}
.hb-verify:focus-visible{outline:2px solid var(--good);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.hb-verify{transition:none}}
.hb-app{padding:0;gap:0;overflow:hidden}
.hb-media{position:relative;aspect-ratio:16/5;background:linear-gradient(135deg,var(--sunk),var(--line)) center/cover no-repeat;border-bottom:1px solid var(--line)}
.hb-media{overflow:hidden}.hb-media-blur{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(22px) saturate(1.3);transform:scale(1.4);opacity:.6}
.hb-size{position:absolute;top:10px;left:10px;padding:3px 9px;border-radius:var(--r-pill);background:rgba(0,0,0,.62);color:var(--white);font-size:var(--fs-xs);font-weight:700;font-variant-numeric:tabular-nums}
.hb-app .src-head{align-items:center;gap:12px;padding:12px 16px 0}.hb-app .src-head>.ss-switch{flex:none}
.hb-icon{width:48px;height:48px;flex:none;border-radius:var(--r-lg);object-fit:cover;background:var(--sunk);border:1px solid var(--line)}
.hb-icon-none{display:grid;place-items:center;font-size:var(--fs-xl);font-weight:var(--fw-bold);color:var(--muted)}
.hb-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 16px 0}
.hb-tags select{width:auto;field-sizing:content;flex:none;height:30px;padding:0 32px 0 12px;background-position:right 12px center;border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:var(--fw-bold);text-overflow:clip}
.hb-extras{display:grid;gap:6px;padding:10px 16px 0;font-size:var(--fs-sm)}
.hb-extras .xline{display:flex;gap:6px;align-items:center;margin:0}.hb-extras .xline>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-xk{flex:none;font-style:normal;font-size:var(--fs-2xs);font-weight:700;color:var(--muted);background:var(--sunk);border-radius:var(--r-sm);padding:2px 7px}
.hb-foot{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:auto;padding:12px 16px 14px}.hb-app>:nth-last-child(2){margin-bottom:14px}
.hb-app button.ib{height:34px;display:inline-flex;align-items:center;gap:6px}
.hb-app button.ib:not(.hb-up){width:34px;padding:0;justify-content:center;position:relative}
.hb-app button.ib:not(.hb-up)>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.hb-extras button.ib:not(.hb-up){width:30px;height:30px}
.hb-app button.ib svg{width:17px;height:17px}
.hb-app.hb-off :is(.hb-media,.hb-icon,.hb-title,.hb-tags,.hb-extras){opacity:.5}.hb-app.hb-off .hb-media{filter:grayscale(1)}
.hb-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.hb-title b{font-size:var(--fs-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-title .muted{font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-foot .danger{margin-left:auto}
.hb-held{border:1px solid var(--warn);border-radius:var(--r-lg);padding:8px 12px;margin:0 0 10px;font-size:var(--fs-sm);overflow-wrap:anywhere}
.hb-held p{margin:4px 0}.hb-held[hidden]{display:none}
dialog h3{margin:0 0 6px;font-size:var(--fs-xl)}
h3.sub-h{margin:18px 0 4px;font-size:var(--fs-md)}
.cred{display:grid;grid-template-columns:max-content 1fr max-content;gap:8px 12px;align-items:center;margin:16px 0}
.cred .v{font-family:ui-monospace,monospace;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-sm);padding:7px 10px;word-break:break-all}
.dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px}
button.ip-more{background:none;border:0;padding:0;min-height:0;color:var(--accent);font:12px ui-monospace,monospace;text-decoration:underline dotted;cursor:pointer;word-break:break-all;text-align:left}
.ip-list{max-height:min(60vh,520px);overflow:auto;margin:12px 0;display:grid;gap:8px}
.ip-row{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;align-items:baseline;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-md);font-size:var(--fs-sm)}
.ip-row .ip-chips{display:flex;flex-wrap:wrap;gap:4px 12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:var(--r-pill);font-size:var(--fs-sm);font-weight:var(--fw-bold);opacity:0;transition:opacity .2s;pointer-events:none}
.toast.show{opacity:1}
.fcard{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:18px;margin-bottom:14px}
.fcard .top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.fcard .top input{flex:1;min-width:180px}
.fgames{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--line);border-radius:var(--r-xl);overflow:hidden}
.fgames li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--sunk)}
.fgames li:last-child{border-bottom:none}
.fgames img{width:40px;height:40px;border-radius:var(--r-md);flex:none;background:var(--line)}
.fgames .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fgames button{padding:4px 9px}
.fp-toggle{margin:0 0 10px}
.fp{border:1px solid var(--line);border-radius:var(--r-xl);padding:10px;background:var(--sunk)}
.fp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.fp-bar .fp-q{flex:1 1 220px;min-width:0}
.fp-bar label.check{display:inline-flex;align-items:center;gap:6px;margin:0}
.fp-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
.fp-list label{display:flex;align-items:center;gap:10px;padding:6px 8px;margin:0;border-radius:var(--r-md);border:1px solid var(--line);background:var(--panel);cursor:pointer;min-width:0}
.fp-list label.on{border-color:var(--good);box-shadow:inset 0 0 0 1px var(--good)}
.fp-list input{flex:none;width:18px;height:18px;margin:0}
.fp-list img{width:36px;height:36px;border-radius:var(--r-md);flex:none;background:var(--line);object-fit:cover}
.fp-list .fp-t{flex:1;min-width:0;display:grid;gap:1px}
.fp-list .fp-n,.fp-list .fp-s{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-list .fp-n{font-weight:var(--fw-bold)}
.fp-list .fp-s{color:var(--muted);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
.fp-pager{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
.fp-pager .fp-info{color:var(--muted);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
.fp-note{color:var(--muted);padding:8px 2px}
.fp-detail{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:12px}
.fp-detail label{flex:1 1 200px;min-width:0}
h2.first{margin-top:0}
.hb-reco{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-bottom:8px}
.hb-reco label{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px 12px;cursor:pointer}
.hb-reco label.added{opacity:.6;cursor:default}
.hb-reco input{margin-top:3px;width:16px;height:16px;flex:none;padding:0}
.hb-reco b{display:block;font-size:var(--fs-sm);word-break:break-all}.hb-reco span{color:var(--muted);font-size:var(--fs-xs)}
:is(td,.gc) select{max-width:none;flex:none}:is(td,.gc) select.hb-cores{min-width:10em}
:is(td,.gc) .err{color:var(--bad);font-size:var(--fs-xs);margin-top:4px}
:is(td,.gc) .muted{color:var(--muted);font-size:var(--fs-xs);margin-top:4px}
:is(td,.gc) a{color:var(--text);text-underline-offset:3px}
.desc-form{display:grid;gap:12px}#gd-body{display:grid;gap:12px}#gd-body h3{margin:6px 0 0;font-size:var(--fs-md)}#gd-body[hidden]{display:none}#gd-form{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);padding:16px}.desc-form label{display:grid;gap:6px;font-size:var(--fs-sm);color:var(--muted);font-weight:var(--fw-bold)}
.desc-form textarea{padding:10px 14px;border-radius:var(--r-lg);border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:var(--fs-md);min-height:90px;resize:vertical}
:is(td,.gc) .desc{color:var(--muted);font-size:var(--fs-xs);margin-top:4px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
form.add select{flex:none;min-width:9em}
.me{margin-left:6px}
/* Phones: the header wraps into two rows so every control keeps a real 44px
   touch target: the brand alone on the first, the four controls under it. */
@media (max-width:640px){
body{padding:16px 16px 80px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}
.brand .wm{font-size:var(--fs-xl)}.brand img{width:32px;height:32px}
.hdr-right{flex:1 1 100%;display:flex;align-items:center;gap:10px}
.hdr-right .icon-btn,.hdr-right .up-entry{width:44px;height:44px;min-width:44px;padding:0}
.hdr-right .lang-btn{height:44px}
.up-entry .up-entry-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
form.add input,form.add select,form.add button{flex:1 1 100%}
table,tbody,tr,td{display:block;width:100%}table{border:0;background:none}
tr:first-child:has(th){display:none}
tr{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);margin-bottom:10px;padding:6px 0}
td{border:0;padding:6px 14px;display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}
td::before{content:attr(data-label);color:var(--muted);font-size:var(--fs-xs)}
td[data-label=""]{grid-template-columns:1fr}td[data-label=""]::before{display:none}
tr.group{background:none;border:0;margin:14px 0 2px;padding:0}
/* The first cell is the card's title, full width, its details under it. */
td:first-child{grid-template-columns:1fr;padding-top:10px}td:first-child::before{display:none}td:first-child b{font-size:var(--fs-md)}
td .row-actions{display:flex;gap:8px}td .row-actions button,td[data-label=""]>button{flex:1 1 0;min-width:0}
td .xline{margin-bottom:8px}td>button{width:100%}
/* A labelled cell holding several things (a list and its button) keeps them all beside the label. */
td:not(:first-child):not([data-label=""])>*{grid-column:2}
}
/* The banner and screenshot dialogs, at every width. */
.hb-banner{width:min(860px,94vw);max-height:88vh;border:1px solid var(--line2);border-radius:var(--r-2xl);background:var(--panel);color:var(--text);padding:20px;box-shadow:0 30px 60px var(--shadow)}
.hb-banner::backdrop{background:rgba(0,0,0,.55)}
.hb-banner-now{margin:12px 0;border-radius:var(--r-xl);overflow:hidden;background:var(--sunk);aspect-ratio:1920/620;display:grid;place-items:center}
.hb-banner-now img{width:100%;height:100%;object-fit:cover;display:block}.hb-banner-now img[hidden]{display:none}
.hb-banner-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:10px 0}
.hb-banner-grid button{padding:0;border:2px solid transparent;border-radius:var(--r-lg);overflow:hidden;background:var(--sunk);cursor:pointer;aspect-ratio:1920/620}
.hb-banner-grid button:hover,.hb-banner-grid button:focus-visible{border-color:var(--accent)}
.hb-banner-grid img{width:100%;height:100%;object-fit:cover;display:block}
.hb-banner-grid figcaption{font-size:var(--fs-xs);color:var(--muted);padding:4px 2px 0;text-align:left}
.hb-banner h4{margin:18px 0 6px}
.hb-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:8px 0}
.hb-shots figure{position:relative;margin:0;border-radius:var(--r-md);overflow:hidden;background:var(--sunk);aspect-ratio:16/9}
.hb-shots img{width:100%;height:100%;object-fit:cover;display:block}
.hb-shots button{position:absolute;top:6px;right:6px;width:28px;height:28px;padding:0;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:var(--white);cursor:pointer}
.btn-like{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:var(--fw-bold);cursor:pointer}
`;



/** The accounts and devices sections, shared by the whole dashboard and the split pages. */

/** The header every admin page shares: brand, menu, upload, language, account and activity. */
/** The page title and the ask dialog, shared by the whole dashboard and the split pages. */
/** The one frame around every admin page: brand, account and menu in the sidebar (a top bar on a phone), plus the phone drawer. */
export const adminChrome = (current) => /* html */ `<aside class="adm-side">${ADMIN_HEADER_HTML}<nav class="adm-side-in" data-top-label="nav" aria-label="서버 관리 메뉴">${sidebarNav(current)}</nav></aside>\n${drawerHtml(current)}`;

export const ADMIN_TITLE_HTML = /* html */ `<title>CookingFoil 서버 관리</title>`;
export const ASK_DIALOG_HTML = /* html */ `<dialog id="ask-dialog" class="ask" aria-labelledby="ask-text">\n  <p id="ask-text"></p>\n  <input id="ask-input" type="text" autocomplete="off" aria-labelledby="ask-text" hidden>\n  <div class="dialog-actions"><button type="button" id="ask-no">취소</button><button type="button" id="ask-ok" class="primary">확인</button></div>\n</dialog>`;

export const ADMIN_HEADER_HTML = /* html */ `<header class="adm-hdr">
  <h1 class="brand" data-top-label="title" aria-label="CookingFoil 서버 관리"><a href="/#all"><img class="logo brand-motion" src="/assets/cookingfoil.svg" alt="" width="42" height="42"><span class="wm">cookingfoil<span class="dot">.</span></span></a></h1>
  <div class="hdr-right">
  ${MENU_BUTTON_HTML}
  <p class="adm-crumb" id="adm-crumb"></p>
  <a class="up-entry" id="up-entry" href="/admin/upload" data-top-label="up.entry" aria-label="파일 올리기">${icon("upload")}<span class="up-entry-t">${top("s.upload")}</span></a>
  ${TOP_LANG_HTML}
  <div class="acct-menu activity-account">
    <button class="icon-btn act-btn" id="acct-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="계정 메뉴 및 서버 활동" title="계정 메뉴 및 서버 활동">${ACTIVITY_BUTTON_HTML}</button>
    <div class="pop-list" id="acct-list" role="dialog" aria-label="계정 메뉴 및 서버 활동" hidden>
      <div class="account-links" role="menu">
      <a role="menuitem" href="/">${icon("home")}${top("web")}</a>
      <a role="menuitem" href="/admin/guide" target="_blank" rel="noopener">${icon("book")}${top("guide")}</a>
      <div class="menu-sep" role="separator"></div>
      <button role="menuitemcheckbox" type="button" class="menu-toggle" id="theme-toggle" aria-checked="false">${icon("moon")}${top("dark")}<span class="switch" aria-hidden="true"></span></button>
      <button role="menuitem" type="button" id="logout">${icon("logout")}${top("logout")}</button>
      </div>
      ${ACTIVITY_HTML}
    </div>
  </div>
  </div>
</header>`;

export function dashboardPage(page = ADMIN_PAGE_BY_PATH.get("/admin"), view = "") {
  const current = { path: page.path, view, countId: page.count ?? "" };
  return /* html */ `<!doctype html><html lang="ko" class="adm"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no,email=no,address=no">
${ADMIN_TITLE_HTML}${ADMIN_HEAD}${GRID_HEAD}<style>${ADMIN_CSS}${PAGE_CSS}${OVERVIEW_CSS}${INTEGRATIONS_CSS}${RETRO_ART_CSS}${ALERTS_CSS}${PATCHES_CSS}${GAME_PICKER_CSS}${SERVER_SETTINGS_CSS}${INBOX_CSS}${NSZ_CSS}${TRASH_CSS}${TRANSFERS_CSS}${LOGS_CSS}${ACTIVITY_CSS}${LIB_BROWSER_CSS}${ORGANIZE_CSS}${ICON_CSS}${BOX_CSS}${GRID_CSS}
${LIST_HELPERS_CSS}
tr.group td{font-weight:var(--fw-bold);color:var(--muted);padding-top:14px}
${POLISH_CSS}${TOP_LANG_CSS}${NAV_CSS}${ADM_SHELL_CSS}</style></head>
<body class="adm-shell">
${adminChrome(current)}
<div class="wrap">

${OVERVIEW_HTML}

${USERS_HTML}

${devicesHtml()}

<section id="tab-settings" hidden>
  <div class="subtabs hide-bar" id="set-subtabs" role="tablist" aria-label="설정 구역">
    <button type="button" role="tab" data-ssub="server" aria-selected="true">${icon("sliders")}서버 동작</button>
    <button type="button" role="tab" data-ssub="integrations" aria-selected="false">${icon("package")}외부 서비스</button>
    <button type="button" role="tab" data-ssub="security" aria-selected="false">${icon("lock")}로그인과 보안</button>
    <button type="button" role="tab" data-ssub="tokens" aria-selected="false">${icon("log")}자동화 토큰</button>
  </div>
  <div data-set-panel="server">${SERVER_SETTINGS_HTML}</div>
  <div data-set-panel="integrations" hidden>${INTEGRATIONS_HTML}</div>
  <div data-set-panel="security" hidden>
  <p class="muted">관리 페이지는 관리자 계정으로 로그인한 뒤에 한 번 더 확인합니다. 관리자 비밀번호나 인증 앱 코드 중 하나를 넣습니다.</p>
  ${GOOGLE_SETTINGS_HTML}
  ${ADMIN_SECURITY_HTML}
  </div>
  <div data-set-panel="tokens" hidden>${TOKENS_HTML}</div>
</section>

<section id="tab-logs" hidden>
  <div class="subtabs hide-bar" id="logs-subtabs" role="tablist" aria-label="로그 종류">
    <button type="button" role="tab" data-lsub="xfer" aria-selected="true">${icon("download")}다운로드 기록</button>
    <button type="button" role="tab" data-lsub="client" aria-selected="false">${icon("device")}클라이언트 로그</button>
    <button type="button" role="tab" data-lsub="deny" aria-selected="false">${icon("lock")}차단과 거부</button>
  </div>
  <div data-logs-panel="xfer">${TRANSFERS_HTML}</div>
  <div data-logs-panel="client" hidden">
  ${LOGS_CLIENT_HTML}
  </div>
  <div data-logs-panel="deny" hidden">
  ${LOGS_SECURITY_HTML}
  </div>
</section>

${FEATURED_HTML}

${LIBRARY_HTML}

${RETRO_ART_HTML}
${ALERTS_HTML}
${INBOX_HTML}
${NSZ_HTML}
${TRASH_HTML}
${HOMEBREW_HTML}

${UPLOAD_HTML}
</div>

${ASK_DIALOG_HTML}
${IP_DIALOG_HTML}
${CRED_DIALOG_HTML}
${HOMEBREW_DIALOG_HTML}
${CONTENT_DIALOG_HTML}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${admRouterScript(page)}${TOP_I18N_SCRIPT}${GRID_SCRIPT}${GAME_PICKER_SCRIPT}${DASHBOARD_SCRIPT}${INTEGRATIONS_SCRIPT}${RETRO_ART_SCRIPT}${ALERTS_SCRIPT}${PATCHES_SCRIPT}${LIBRARY_FILES_SCRIPT}${LIB_BROWSER_SCRIPT}${ORGANIZE_SCRIPT}${SERVER_SETTINGS_SCRIPT}${TOKENS_SCRIPT}${INBOX_SCRIPT}${NSZ_SCRIPT}${TRASH_SCRIPT}${TRANSFERS_SCRIPT}${ACTIVITY_SCRIPT}${POLISH_SCRIPT}${BOX_SCRIPT}${NAV_SCRIPT}</script></body></html>`;
}
