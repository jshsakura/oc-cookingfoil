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
import { LIBRARY_VERIFY_HTML, LIBRARY_FILES_SCRIPT } from "./library-files-panel.js";
import { LIB_BROWSER_CSS, LIB_BROWSER_HTML, LIB_BROWSER_SCRIPT } from "./library-browser-panel.js";
import { ORGANIZE_CSS, ORGANIZE_HTML, ORGANIZE_SCRIPT } from "./library-organize-panel.js";
import { CONTENT_DIALOG_HTML, GAME_PATCHES_HTML, PATCHES_CSS, PATCHES_HTML, PATCHES_SCRIPT, SAVES_HTML } from "./patches-panel.js";
import { TOKENS_HTML, TOKENS_SCRIPT } from "./tokens-panel.js";
import { CLIENT_RELEASE_HTML, CLIENT_RELEASE_SCRIPT } from "./client-release-panel.js";
import { connectHowto } from "./connect-howto.js";
import { INBOX_CSS, INBOX_HTML, INBOX_SCRIPT } from "./inbox-panel.js";
import { NSZ_CSS, NSZ_HTML, NSZ_SCRIPT } from "./nsz-panel.js";
import { TRASH_CSS, TRASH_HTML, TRASH_SCRIPT } from "./trash-panel.js";
import { TRANSFERS_CSS, TRANSFERS_HTML, TRANSFERS_SCRIPT } from "./transfers-panel.js";
import { POLISH_CSS, POLISH_SCRIPT } from "./polish.js";
import { NAV_CSS, NAV_SCRIPT } from "./nav-structure.js";
import { ACTIVITY_CSS, ACTIVITY_HTML, ACTIVITY_BUTTON_HTML, ACTIVITY_SCRIPT } from "./activity-panel.js";
import { BOX_CSS, BOX_SCRIPT, box } from "./boxes.js";
import { TOP_I18N_SCRIPT, TOP_LANG_CSS, TOP_LANG_HTML, top, topPh } from "./top-i18n.js";
import { GRID_CSS, GRID_HEAD, GRID_SCRIPT } from "./grid.js";
import { GAME_PICKER_CSS, GAME_PICKER_SCRIPT } from "./game-picker.js";

const PAGE_CSS = /* css */ `
${BRAND_MOTION_CSS}
body{padding:28px 32px 80px}.wrap{max-width:1240px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.brand{margin:0}.brand a{display:flex;align-items:center;gap:12px;color:var(--text);text-decoration:none}
.logo{width:44px;height:44px;flex:none}
.brand .wm{font-family:'Baloo 2',inherit;font-size:31px;font-weight:800;letter-spacing:-.02em;line-height:1;padding-top:4px}.brand .wm .dot{color:var(--accent)}
/* the dashboard's view switch, so the admin page reads as its third tab */
.apptabs{display:inline-flex;gap:2px;padding:3px;margin-right:auto;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.apptabs a{padding:6px 14px;border-radius:100px;color:var(--muted);text-decoration:none;font-weight:600;font-size:13px;white-space:nowrap}
.apptabs a:hover{color:var(--text)}.apptabs a[aria-current="page"]{background:var(--text);color:var(--bg)}
.tfa{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:22px}
.tfa .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tfa-setup{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}.tfa-setup[hidden]{display:none}
.tfa-qr{width:180px;height:180px;background:#fff;border-radius:12px;padding:6px}.tfa-qr svg{width:100%;height:100%;display:block}
.tfa-key{font-family:ui-monospace,monospace;font-size:15px;letter-spacing:1px;word-break:break-all;background:var(--sunk);border-radius:10px;padding:10px 12px}
@media(max-width:640px){.tfa-setup{grid-template-columns:1fr}}
.who{color:var(--muted);font-size:13px}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.seg button{border:none;border-radius:100px;padding:6px 10px;color:var(--muted)}
.seg button.active{background:var(--text);color:var(--bg)}
.seg svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* The same segmented bar as the library's kind tabs: the tabs share the full width, the open one is raised. */
nav.tabs{display:flex;gap:2px;padding:5px;margin-bottom:22px;overflow-x:auto;scrollbar-width:none;background:var(--sunk);border:1px solid var(--line);border-radius:16px}
nav.tabs::-webkit-scrollbar{display:none}
/* Six menus in one slim row across the full width, the icon beside each label. */
@media (min-width:641px){nav.tabs{display:flex;padding:4px;border-radius:14px}
  nav.tabs a{flex:1 1 0;min-width:0;flex-direction:row;gap:7px;padding:8px 10px;font-size:13.5px;border-radius:10px}nav.tabs a svg{width:16px;height:16px}
  nav.tabs .count{margin-left:2px}}
nav.tabs a{flex:1 0 auto;justify-content:center;padding:9px 8px;color:var(--muted);text-decoration:none;font-weight:700;border-radius:12px;white-space:nowrap;transition:color .15s,background .15s,box-shadow .15s}
nav.tabs a:hover{color:var(--text)}
/* The second row: the pages inside the chosen menu, the current one filled like the console's sidebar. */
.group-tabs{display:flex;gap:6px;margin:-4px 0 22px;overflow-x:auto;scrollbar-width:none}.group-tabs::-webkit-scrollbar{display:none}
.group-tabs[hidden]{display:none}
.group-tabs a{flex:none;display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:12px;color:var(--muted);font-weight:700;font-size:13.5px;text-decoration:none;position:relative}
.group-tabs a svg{width:16px;height:16px}
.group-tabs a:hover{color:var(--text);background:var(--sunk)}
.group-tabs a[aria-current="page"]{background:var(--text);color:var(--panel)}
.group-tabs a[hidden]{display:none}
nav.tabs a[aria-current="page"]{color:var(--text);background:var(--panel);box-shadow:0 1px 3px var(--shadow),0 0 0 1px var(--line2)}
.count[hidden]{display:none}
.count{display:inline-block;min-width:18px;padding:0 6px;margin-left:6px;border-radius:100px;font-size:11px;background:rgba(var(--bad-rgb),.18);color:var(--bad)}
section[hidden]{display:none}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px 20px}
.card .v{font-size:28px;font-weight:800;letter-spacing:-.02em}
.card .l{color:var(--muted);font-size:12px}
.card.alert{border-color:rgba(var(--bad-rgb),.45)}.card.alert .v{color:var(--bad)}
.lanes{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}
.scroll{overflow-x:auto}
.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.hd{margin:24px 0 10px}.hd:first-child{margin-top:0}.hd h2,.hd h2.first{margin:0}
form.add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:16px}
form.add input{flex:1;min-width:150px}
form.add label.toggle{flex-basis:100%;display:flex;align-items:center;gap:8px;font-weight:600}
form.add label.toggle input{flex:none;min-width:0;width:18px;height:18px}
.copy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.copy-row[hidden],.add[hidden]{display:none}
/* One account menu, the same as the web page's: a circle that opens who you are, the web page, the guide and sign out. */
.acct-menu{position:relative}
.icon-btn{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;border-radius:100px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}
.icon-btn:hover,.icon-btn[aria-expanded="true"]{border-color:var(--text)}.icon-btn .ico{width:19px;height:19px}
.pop-list{position:absolute;right:0;top:calc(100% + 6px);z-index:60;min-width:210px;padding:6px;display:grid;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 36px var(--shadow)}
.pop-list[hidden]{display:none}
/* The signed-in account as a plain label: phones must not turn an email address into a mail link. */
.pop-list p.who{display:block;box-sizing:border-box;width:fit-content;max-width:calc(100% - 8px);margin:4px 6px 10px;padding:5px 11px;border:0;border-radius:100px;background:var(--sunk);font-size:12.5px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;pointer-events:none;color:var(--muted)}
.pop-list a,.pop-list button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;padding:9px 12px;border:0;border-radius:9px;background:none;text-decoration:none;color:var(--text);font:600 14px inherit;text-align:left;cursor:pointer}
.pop-list a:hover,.pop-list button:hover{background:var(--sunk)}.pop-list #logout{color:var(--bad)}
/* theme: one row with a switch; on means dark */
.pop-list .menu-sep{height:1px;margin:4px 6px;background:var(--line)}
.menu-toggle .switch{position:relative;flex:none;width:34px;height:20px;margin-left:auto;border-radius:100px;background:var(--line);transition:background .15s}
.menu-toggle .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.menu-toggle[aria-checked="true"] .switch{background:var(--text)}
.menu-toggle[aria-checked="true"] .switch::after{transform:translateX(14px)}
@media (prefers-reduced-motion:reduce){.menu-toggle .switch,.menu-toggle .switch::after{transition:none}}
.howto-list{margin:0;padding-left:20px;display:grid;gap:6px;font-size:14px;line-height:1.6}
#tab-overview>.copy-row{margin-bottom:12px}
.copy-row code{flex:1;min-width:0;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px;user-select:all}
.up-kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.up-kinds button{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:3px;text-align:left;padding:12px 14px;border-radius:14px}
.up-kinds button span{font-size:12px;font-weight:400;color:var(--muted)}
#up-form [hidden]{display:none!important}
.up-group{margin:4px 0 8px;font-size:12.5px;font-weight:700;color:var(--muted)}
/* Retro consoles as small tiles; once one is picked the rest fold away behind "다른 기종". */
.up-systems{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}.up-systems[data-skel]:empty{min-height:120px}
.up-systems button{flex-direction:row;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;min-height:42px}
.up-systems button img{width:22px;height:22px;object-fit:contain;flex:none}
.up-systems button b{min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.up-systems.folded button[data-system][aria-pressed="false"]{display:none}
.up-systems .up-more-sys{justify-content:center;color:var(--muted);font-weight:700}
.up-kinds button[aria-pressed="true"] span{color:inherit;opacity:.75}
.up-hint{margin:0 0 12px;min-height:1.4em}.up-hint:empty{display:none}
.up-lead{margin:0 0 12px}
.up-guess{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.up-guess p{margin:0;flex:1 1 220px;font-size:14px}.up-guess.warn{border-color:var(--accent)}
.up-guess[hidden],#up-kinds[hidden],#up-systems-wrap[hidden]{display:none}
.up-systems.cands button[data-system]:not(.cand){display:none}
.up-plan{margin:0;font-size:13px;color:var(--muted)}.up-plan:empty{display:none}
.up-sum{margin:14px 0 0;font-weight:700;font-size:14px}.up-sum[hidden]{display:none}
.up-log .note .row-actions{margin-top:8px}
.up-drop{display:grid;justify-items:center;gap:8px;text-align:center;padding:34px 20px;margin-bottom:14px;border:2px dashed var(--line);border-radius:20px;background:var(--panel);cursor:pointer;transition:border-color .15s,background .15s}
.up-drop:hover,.up-drop:focus-visible,.up-drop.over{border-color:var(--accent);background:rgba(var(--accent-rgb),.08);outline:none}
.up-drop svg{width:40px;height:40px;fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.up-drop b{font-size:17px}.up-drop span{color:var(--muted);font-size:13px;max-width:520px;word-break:break-word}
.up-drop.has span{color:var(--text);font-weight:600}
.up-drop .pick{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.up-go{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ended-box{margin-top:12px}.ended-box summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600;margin-bottom:8px}
.up-more summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
.up-more[open]{display:grid;gap:12px}.up-more[hidden]{display:none}
.up-more label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
.up-foot{margin-top:12px}
body.dragging #tab-upload .up-drop{border-color:var(--accent)}
.up-kinds button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
form.up{display:grid;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
form.up[hidden]{display:none}
form.up label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
form.up label[hidden]{display:none}
form.up label.check,:is(td,.gc) label.check{display:flex;gap:8px;align-items:center;color:var(--text)}
form.up textarea{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px;min-height:72px;resize:vertical}
.bar{height:8px;border-radius:8px;background:var(--sunk);overflow:hidden}
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
.src-card{display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.src-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.src-head a{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-ver{flex:none;font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.src-desc{margin:0;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.src-facts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin:0}
.src-facts dt{font-size:11.5px;color:var(--muted);margin-bottom:3px}.src-facts dd{margin:0;font-size:13px;min-width:0}
.src-facts select{width:100%}
.src-state{display:grid;gap:6px;font-size:12.5px}
.src-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
.src-foot select{width:auto}.src-foot .danger{margin-left:auto}
@media (min-width:641px){:is(td,.gc) button.ib{width:36px;height:36px;padding:0;position:relative}
  :is(td,.gc) button.ib>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
:is(td,.gc) .pills{display:flex;flex-wrap:wrap;gap:6px}
:is(td,.gc) .xline{display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:13px}:is(td,.gc) .xline>span{flex:1;min-width:0}
:is(td,.gc).dim{color:var(--faint)}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
dl.kv dt{color:var(--muted);font-size:13px}dl.kv dd{margin:0;font-size:13px;word-break:break-all}
dialog{border:1px solid var(--line2);border-radius:22px;background:var(--panel);color:var(--text);padding:24px;width:min(520px,calc(100vw - 32px));box-shadow:0 30px 60px var(--shadow)}
dialog::backdrop{background:rgba(0,0,0,.55)}
dialog.ask{width:min(420px,calc(100vw - 32px))}dialog.ask input{width:100%;box-sizing:border-box;margin:0 0 14px}dialog.ask p{margin:2px 0 14px;font-size:15px;line-height:1.55;overflow-wrap:anywhere}
button.danger-solid{background:var(--bad);border-color:var(--bad);color:#fff;font-weight:700}button.danger-solid:hover{filter:brightness(1.06);border-color:var(--bad)}
.hb-verify{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px 0 9px;border-radius:100px;border:1px dashed var(--line);background:transparent;color:var(--faint);font:inherit;font-size:12.5px;font-weight:700;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s,box-shadow .15s}
.tfa-warn{color:var(--bad,#d33)!important;font-weight:600}
.tfa-ok{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-bottom:14px;border-radius:14px;border:1px solid rgba(var(--good-rgb),.45);background:rgba(var(--good-rgb),.12)}
.tfa-ok svg{flex:none;width:30px;height:30px;fill:none;stroke:var(--good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tfa-ok b{display:block;color:var(--good);font-size:14px}.tfa-ok span{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
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
.hb-size{position:absolute;top:10px;left:10px;padding:3px 9px;border-radius:100px;background:rgba(0,0,0,.62);color:#fff;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.hb-app .src-head{align-items:center;gap:12px;padding:12px 16px 0}.hb-app .src-head>.ss-switch{flex:none}
.hb-icon{width:48px;height:48px;flex:none;border-radius:12px;object-fit:cover;background:var(--sunk);border:1px solid var(--line)}
.hb-icon-none{display:grid;place-items:center;font-size:20px;font-weight:800;color:var(--muted)}
.hb-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 16px 0}
.hb-tags select{width:auto;field-sizing:content;flex:none;height:30px;padding:0 32px 0 12px;background-position:right 12px center;border-radius:100px;font-size:12.5px;font-weight:600;text-overflow:clip}
.hb-extras{display:grid;gap:6px;padding:10px 16px 0;font-size:13px}
.hb-extras .xline{display:flex;gap:6px;align-items:center;margin:0}.hb-extras .xline>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-xk{flex:none;font-style:normal;font-size:11.5px;font-weight:700;color:var(--muted);background:var(--sunk);border-radius:6px;padding:2px 7px}
.hb-foot{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:auto;padding:12px 16px 14px}.hb-app>:nth-last-child(2){margin-bottom:14px}
.hb-app button.ib{height:34px;display:inline-flex;align-items:center;gap:6px}
.hb-app button.ib:not(.hb-up){width:34px;padding:0;justify-content:center;position:relative}
.hb-app button.ib:not(.hb-up)>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.hb-extras button.ib:not(.hb-up){width:30px;height:30px}
.hb-app button.ib svg{width:17px;height:17px}
.hb-app.hb-off :is(.hb-media,.hb-icon,.hb-title,.hb-tags,.hb-extras){opacity:.5}.hb-app.hb-off .hb-media{filter:grayscale(1)}
.hb-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.hb-title b{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-title .muted{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-foot .danger{margin-left:auto}
.hb-held{border:1px solid var(--warn);border-radius:12px;padding:8px 12px;margin:0 0 10px;font-size:13px;overflow-wrap:anywhere}
.hb-held p{margin:4px 0}.hb-held[hidden]{display:none}
dialog h3{margin:0 0 6px;font-size:18px}
h3.sub-h{margin:18px 0 4px;font-size:15px}
.cred{display:grid;grid-template-columns:max-content 1fr max-content;gap:8px 12px;align-items:center;margin:16px 0}
.cred .v{font-family:ui-monospace,monospace;background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:7px 10px;word-break:break-all}
.dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:100px;font-size:13px;font-weight:600;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.show{opacity:1}
.fcard{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:14px}
.fcard .top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.fcard .top input{flex:1;min-width:180px}
.fgames{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.fgames li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--sunk)}
.fgames li:last-child{border-bottom:none}
.fgames img{width:40px;height:40px;border-radius:10px;flex:none;background:var(--line)}
.fgames .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fgames button{padding:4px 9px}
.fp-toggle{margin:0 0 10px}
.fp{border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--sunk)}
.fp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.fp-bar .fp-q{flex:1 1 220px;min-width:0}
.fp-bar label.check{display:inline-flex;align-items:center;gap:6px;margin:0}
.fp-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
.fp-list label{display:flex;align-items:center;gap:10px;padding:6px 8px;margin:0;border-radius:10px;border:1px solid var(--line);background:var(--panel);cursor:pointer;min-width:0}
.fp-list label.on{border-color:var(--good);box-shadow:inset 0 0 0 1px var(--good)}
.fp-list input{flex:none;width:18px;height:18px;margin:0}
.fp-list img{width:36px;height:36px;border-radius:9px;flex:none;background:var(--line);object-fit:cover}
.fp-list .fp-t{flex:1;min-width:0;display:grid;gap:1px}
.fp-list .fp-n,.fp-list .fp-s{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-list .fp-n{font-weight:600}
.fp-list .fp-s{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.fp-pager{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
.fp-pager .fp-info{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.fp-note{color:var(--muted);padding:8px 2px}
.fp-detail{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:12px}
.fp-detail label{flex:1 1 200px;min-width:0}
h2.first{margin-top:0}
.note .note-go{margin-top:10px}
.hb-reco{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-bottom:8px}
.hb-reco label{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;cursor:pointer}
.hb-reco label.added{opacity:.6;cursor:default}
.hb-reco input{margin-top:3px;width:16px;height:16px;flex:none;padding:0}
.hb-reco b{display:block;font-size:13px;word-break:break-all}.hb-reco span{color:var(--muted);font-size:12px}
:is(td,.gc) select{max-width:none;flex:none}:is(td,.gc) select.hb-cores{min-width:10em}
:is(td,.gc) .err{color:var(--bad);font-size:12px;margin-top:4px}
:is(td,.gc) .muted{color:var(--muted);font-size:12px;margin-top:4px}
:is(td,.gc) a{color:var(--text);text-underline-offset:3px}
.desc-form{display:grid;gap:12px}#gd-body{display:grid;gap:12px}#gd-body h3{margin:6px 0 0;font-size:15px}#gd-body[hidden]{display:none}#gd-form{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.desc-form label{display:grid;gap:6px;font-size:13px;color:var(--muted);font-weight:600}
.desc-form textarea{padding:10px 14px;border-radius:12px;border:1px solid transparent;background:var(--sunk);color:var(--text);font:inherit;font-size:14px;min-height:90px;resize:vertical}
:is(td,.gc) .desc{color:var(--muted);font-size:12px;margin-top:4px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
form.add select{flex:none;min-width:9em}
.logs-view{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:12px;margin-bottom:8px}
.logs-list{display:grid;gap:8px;align-content:start;max-height:520px;overflow:auto}
.logs-list details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.logs-list summary{cursor:pointer;font-weight:700;display:flex;justify-content:space-between;gap:8px}
.logs-list summary span{color:var(--muted);font-weight:500;font-size:12px}
.logs-list button{display:flex;width:100%;justify-content:space-between;margin-top:6px;padding:7px 10px;font-weight:500}
.logs-list button[aria-pressed="true"]{border-color:var(--accent);background:rgba(var(--accent-rgb),.14)}
.logs-body{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
.logs-head{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.logs-body pre{margin:0;padding:14px;min-height:220px;max-height:520px;overflow:auto;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.me{margin-left:6px}
/* Phones: tables turn into one card per row, each cell labelled. */
@media (max-width:640px){
body{padding:16px 16px 80px}header{margin-bottom:12px}
.brand .wm{font-size:24px}.brand img{width:32px;height:32px}
/* Every menu in sight: two rows of five, icon over label, instead of a strip that hides half of them. */
nav.tabs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:6px;margin-bottom:18px;overflow:visible}
nav.tabs a{flex-direction:column;justify-content:center;gap:3px;padding:8px 2px;font-size:12px;border-radius:10px;text-align:center}
nav.tabs a svg{width:18px;height:18px}nav.tabs .count{position:absolute;margin:-30px 0 0 26px}nav.tabs a{position:relative}
form.add input,form.add select,form.add button{flex:1 1 100%}
.logs-view{grid-template-columns:1fr}
table,tbody,tr,td{display:block;width:100%}table{border:0;background:none}
tr:first-child:has(th){display:none}
tr{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;padding:6px 0}
td{border:0;padding:6px 14px;display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}
td::before{content:attr(data-label);color:var(--muted);font-size:12px}
td[data-label=""]{grid-template-columns:1fr}td[data-label=""]::before{display:none}
tr.group{background:none;border:0;margin:14px 0 2px;padding:0}
/* The first cell is the card's title, full width, its details under it. */
td:first-child{grid-template-columns:1fr;padding-top:10px}td:first-child::before{display:none}td:first-child b{font-size:15px}
td .row-actions{display:flex;gap:8px}td .row-actions button,td[data-label=""]>button{flex:1 1 0;min-width:0}
td .xline{margin-bottom:8px}td>button{width:100%}
/* A labelled cell holding several things (a list and its button) keeps them all beside the label. */
td:not(:first-child):not([data-label=""])>*{grid-column:2}
}
/* The banner and screenshot dialogs, at every width. */
.hb-banner{width:min(860px,94vw);max-height:88vh;border:1px solid var(--line2);border-radius:22px;background:var(--panel);color:var(--text);padding:20px;box-shadow:0 30px 60px var(--shadow)}
.hb-banner::backdrop{background:rgba(0,0,0,.55)}
.hb-banner-now{margin:12px 0;border-radius:14px;overflow:hidden;background:var(--sunk);aspect-ratio:1920/620;display:grid;place-items:center}
.hb-banner-now img{width:100%;height:100%;object-fit:cover;display:block}.hb-banner-now img[hidden]{display:none}
.hb-banner-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:10px 0}
.hb-banner-grid button{padding:0;border:2px solid transparent;border-radius:12px;overflow:hidden;background:var(--sunk);cursor:pointer;aspect-ratio:1920/620}
.hb-banner-grid button:hover,.hb-banner-grid button:focus-visible{border-color:var(--accent)}
.hb-banner-grid img{width:100%;height:100%;object-fit:cover;display:block}
.hb-banner-grid figcaption{font-size:12px;color:var(--muted);padding:4px 2px 0;text-align:left}
.hb-banner h4{margin:18px 0 6px}
.hb-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:8px 0}
.hb-shots figure{position:relative;margin:0;border-radius:10px;overflow:hidden;background:var(--sunk);aspect-ratio:16/9}
.hb-shots img{width:100%;height:100%;object-fit:cover;display:block}
.hb-shots button{position:absolute;top:6px;right:6px;width:28px;height:28px;padding:0;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;cursor:pointer}
.btn-like{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--line2);border-radius:10px;font-weight:600;cursor:pointer}
`;


export function dashboardPage() {
  return /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no,email=no,address=no">
<title>CookingFoil 서버 관리</title>${ADMIN_HEAD}${GRID_HEAD}<style>${ADMIN_CSS}${PAGE_CSS}${INTEGRATIONS_CSS}${RETRO_ART_CSS}${ALERTS_CSS}${PATCHES_CSS}${GAME_PICKER_CSS}${SERVER_SETTINGS_CSS}${INBOX_CSS}${NSZ_CSS}${TRASH_CSS}${TRANSFERS_CSS}${ACTIVITY_CSS}${LIB_BROWSER_CSS}${ORGANIZE_CSS}${ICON_CSS}${BOX_CSS}${GRID_CSS}
nav.tabs a{display:inline-flex;align-items:center;gap:7px}.pg-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:0 0 12px}.pg-bar[hidden]{display:none}
.pg-q{flex:1 1 200px;min-width:0;max-width:340px}.pg-per{flex:none}
.pg-info{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.pg-nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.pg-n{min-width:38px;padding-left:10px;padding-right:10px;font-variant-numeric:tabular-nums}
.pg-n[aria-current="page"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pg-gap{color:var(--faint)}
@media (max-width:600px){.pg-q{max-width:none;flex-basis:100%}.pg-nav{margin-left:0;width:100%;justify-content:center}}
.logs-view{align-items:stretch}
.logs-list summary{align-items:center}.logs-list summary>b{display:grid;gap:1px;min-width:0;font-weight:700}
.logs-list summary>b small{font:500 11px ui-monospace,monospace;color:var(--muted);letter-spacing:.02em}
.logs-list button{gap:10px}.logs-list button span{white-space:nowrap;font-variant-numeric:tabular-nums}
.logs-list summary span{white-space:nowrap}
.logs-body{min-height:320px}
.logs-body pre{flex:1}.logs-body pre[hidden],.logs-head[hidden]{display:none}
.logs-empty{flex:1;display:grid;place-content:center;justify-items:center;gap:6px;padding:30px 20px;text-align:center;color:var(--muted)}
.logs-empty b{color:var(--text);font-size:15px}.logs-empty span{font-size:13px}
.logs-empty[hidden]{display:none}.logs-empty-ico{width:38px;height:38px;color:var(--faint);stroke-width:1.5;margin-bottom:4px}
#bug-reports table{width:100%}#bug-reports td,#bug-reports th{white-space:nowrap}#bug-reports td:nth-child(3){white-space:normal}
tr.group td{font-weight:600;color:var(--muted);padding-top:14px}
.rk{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:100px;font-weight:800;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.rk.r1{background:#f5c542;color:#3d2e00}.rk.r2{background:#cfd3d9;color:#2a2e35}.rk.r3{background:#d9a574;color:#3b2410}
.rk-key{display:block;font:500 11px ui-monospace,monospace;color:var(--muted)}
${POLISH_CSS}${TOP_LANG_CSS}${NAV_CSS}</style></head><body>
<div class="wrap">
<header>
  <h1 class="brand" data-top-label="title" aria-label="CookingFoil 서버 관리"><a href="/#all"><img class="logo brand-motion" src="/assets/cookingfoil.svg" alt="" width="42" height="42"><span class="wm">cookingfoil<span class="dot">.</span></span></a></h1>
  <div class="hdr-right">
  <a class="up-entry" id="up-entry" href="#upload" data-top-label="up.entry" aria-label="파일 올리기">${icon("upload")}<span class="up-entry-t">${top("s.upload")}</span></a>
  ${TOP_LANG_HTML}
  <div class="acct-menu activity-account">
    <button class="icon-btn act-btn" id="acct-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="계정 메뉴 및 서버 활동" title="계정 메뉴 및 서버 활동">${ACTIVITY_BUTTON_HTML}</button>
    <div class="pop-list" id="acct-list" role="dialog" aria-label="계정 메뉴 및 서버 활동" hidden>
      <div class="account-links" role="menu">
      <p class="who" id="who">불러오고 있습니다</p>
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
</header>

<nav class="tabs" data-top-label="nav" aria-label="서버 관리 메뉴">
  <a href="#overview" data-group="overview">${icon("dashboard")}${top("g.overview")}</a>
  <a href="#library" data-group="games">${icon("folder")}${top("g.games")}<span class="count" data-sum="games" hidden></span></a>
  <a href="#retro" data-group="retro">${icon("image")}${top("g.retro")}</a>
  <a href="#homebrew" data-group="homebrew">${icon("package")}${top("g.homebrew")}</a>
  <a href="#users" data-group="people">${icon("users")}${top("g.people")}<span class="count" data-sum="people" hidden></span></a>
  <a href="#logs" data-group="ops">${icon("sliders")}${top("g.ops")}<span class="count" data-sum="ops" hidden></span></a>
</nav>
<nav class="group-tabs" id="group-tabs" data-top-label="subnav" aria-label="세부 메뉴">
  <a href="#library" data-tab="library" data-in="games">${icon("folder")}${top("s.library")}</a>
  <a href="#upload" data-tab="upload" data-in="games">${icon("upload")}${top("s.upload")}</a>
  <a href="#nsz" data-tab="nsz" data-in="games">${icon("shrink")}${top("s.nsz")}</a>
  <a href="#inbox" data-tab="inbox" data-in="games">${icon("inbox")}${top("s.inbox")}<span class="count" id="inbox-count" hidden></span></a>
  <a href="#featured" data-tab="featured" data-in="games">${icon("star")}${top("s.featured")}</a>
  <a href="#trash" data-tab="trash" data-in="games">${icon("trash")}${top("s.trash")}</a>
  <a href="#users" data-tab="users" data-in="people">${icon("users")}${top("s.users")}<span class="count" id="account-count" hidden></span></a>
  <a href="#devices" data-tab="devices" data-in="people">${icon("device")}${top("s.devices")}<span class="count" id="pending-count" hidden></span></a>
  <a href="#logs" data-tab="logs" data-in="ops">${icon("log")}${top("s.logs")}<span class="count" id="lock-count" hidden></span></a>
  <a href="#alerts" data-tab="alerts" data-in="ops">${icon("bell")}${top("s.alerts")}</a>
  <a href="#settings" data-tab="settings" data-in="ops">${icon("sliders")}${top("s.settings")}</a>
  <a href="#overview" data-tab="overview" data-in="overview" hidden></a>
  <a href="#retro" data-tab="retro" data-in="retro" hidden></a>
  <a href="#homebrew" data-tab="homebrew" data-in="homebrew" hidden></a>
</nav>

<section id="tab-overview">
  <h2 class="first">연결</h2>
  <div class="copy-row"><code id="shop-url">—</code><button type="button" id="shop-url-copy">복사</button></div>
  ${box("connect-howto", "기기를 연결하는 방법", `<ul class="howto-list">${connectHowto().map((line) => `<li>${line}</li>`).join("")}</ul>`, { level: "h3", folded: true })}
  <div id="warnings"></div>
  <div class="lanes" id="lanes"></div>
  <div class="lanes" id="health"></div>
  <p class="muted" id="health-hint" hidden></p>
  <div class="cards" id="cards"></div>
  ${box("client-release", "클라이언트 빌드", CLIENT_RELEASE_HTML, { meta: "기기에 내려줄 CookingFoil 을 받는 곳" })}
  <p class="muted" id="ts"></p>
</section>

<section id="tab-users" hidden>
  <div class="subtabs" id="users-subtabs" role="tablist" aria-label="사용자 구역">
    <button type="button" role="tab" data-sub="local" aria-selected="true">${icon("users")}계정</button>
    <button type="button" role="tab" data-sub="google" aria-selected="false">${icon("lock")}구글 로그인 계정<span class="count" id="account-sub-count" hidden></span></button>
  </div>
  <div data-sub-panel="local">
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" placeholder="사용자 이름 (영문, 숫자, . _ -)" aria-label="사용자 이름" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" placeholder="비밀번호 (비우면 자동 생성)" aria-label="비밀번호" maxlength="128">
    <select id="new-role" aria-label="역할"><option value="user">일반 사용자</option><option value="admin">관리자</option></select>
    <button class="primary" type="submit">사용자 추가</button>
  </form>
  <div class="scroll" id="users" data-skel></div>
  ${box("users-help", "계정 안내", `<p class="muted">웹은 이 계정으로 /login 에서 로그인합니다. 콘솔은 비밀번호로 접속하지 않고, 연결을 요청할 때 한 번 이 아이디와 비밀번호로 승인받을 수 있습니다. 관리자만 이 관리 페이지를 엽니다. 비밀번호는 만들거나 바꿀 때 한 번만 보여 주고 서버에는 해시만 남깁니다.</p>`, { level: "h3" })}
  </div>
  <div data-sub-panel="google" hidden>
  <p class="muted" id="accounthint"></p>
  <div class="scroll" id="accounts" data-skel></div>
  </div>
</section>

<section id="tab-devices" hidden>
  <div class="subtabs" id="devices-subtabs" role="tablist" aria-label="기기 구역">
    <button type="button" role="tab" data-sub="pending" aria-selected="true">${icon("bell")}승인 대기<span class="count" id="pending-sub-count" hidden></span></button>
    <button type="button" role="tab" data-sub="approved" aria-selected="false">${icon("device")}승인된 기기</button>
    <button type="button" role="tab" data-sub="clients" aria-selected="false">${icon("download")}웹에서 받은 클라이언트</button>
  </div>
  <div data-sub-panel="pending">
  <p class="muted" id="devhint"></p>
  <form class="add" id="approve-code">
    <input id="code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="기기 화면의 기기 코드 8자리" aria-label="기기 코드" required maxlength="9">
    <input id="code-label" autocomplete="off" placeholder="기기 이름 (선택)" aria-label="기기 이름" maxlength="64">
    <button class="primary" type="submit">기기 코드로 승인</button>
  </form>
  <div class="scroll" id="pending" data-skel></div>
  </div>
  <div data-sub-panel="approved" hidden><div class="scroll" id="devices" data-skel></div></div>
  <div data-sub-panel="clients" hidden>
  <p class="muted">웹 페이지에서 다운로드된 사전 연동 클라이언트입니다. 발급 시 계정별 일회용 자동 연동 키(유효시간 24시간)가 포함되며, 기기에서 앱을 최초 실행하면 해당 계정의 기기로 자동 승인됩니다. 키 원본은 서버에 저장되지 않습니다.</p>
  <div class="scroll" id="clients" data-skel></div>
  <details class="ended-box" id="clients-ended-box" hidden><summary>만료되거나 취소한 항목 (<span id="clients-ended-count">0</span>)</summary><div class="scroll" id="clients-ended" data-skel></div></details>
  </div>
</section>

<section id="tab-settings" hidden>
  <div class="subtabs" id="set-subtabs" role="tablist" aria-label="설정 구역">
    <button type="button" role="tab" data-ssub="server" aria-selected="true">${icon("sliders")}서버 동작</button>
    <button type="button" role="tab" data-ssub="integrations" aria-selected="false">${icon("package")}외부 서비스</button>
    <button type="button" role="tab" data-ssub="security" aria-selected="false">${icon("lock")}로그인과 보안</button>
    <button type="button" role="tab" data-ssub="tokens" aria-selected="false">${icon("log")}자동화 토큰</button>
  </div>
  <div data-set-panel="server">${SERVER_SETTINGS_HTML}</div>
  <div data-set-panel="integrations" hidden>${INTEGRATIONS_HTML}</div>
  <div data-set-panel="security" hidden>
  <p class="muted">관리 페이지는 관리자 계정으로 로그인한 뒤에 한 번 더 확인합니다. 관리자 비밀번호나 인증 앱 코드 중 하나를 넣습니다.</p>
  ${box("sec-google", "구글 로그인", `
  <p class="muted">구글 로그인은 덤입니다. 꺼 두면 아이디와 비밀번호로만 로그인하고, 켜면 로그인 화면에 구글 버튼이 붙습니다. 저장하면 바로 적용합니다.</p>
  <form class="add google-form" id="google-form" autocomplete="off">
    <label class="toggle"><input type="checkbox" id="g-enabled"> 구글 로그인(OAuth) 사용</label>
    <input id="g-id" placeholder="클라이언트 ID (….apps.googleusercontent.com)" aria-label="클라이언트 ID" maxlength="200" spellcheck="false">
    <input id="g-secret" type="password" autocomplete="new-password" placeholder="클라이언트 시크릿" aria-label="클라이언트 시크릿" maxlength="200">
    <button class="primary" type="submit">저장</button>
    <button type="button" id="g-clear" class="danger">키 삭제</button>
  </form>
  <p class="muted">구글 클라우드 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 아래 리디렉션 URI를 등록합니다.</p>
  <div class="copy-row"><code id="g-redirect">불러오고 있습니다</code><button type="button" id="g-copy">복사</button></div>
  <p class="muted" id="g-status"></p>
  `, { meta: "로그인 화면의 구글 버튼" })}
  ${box("sec-tfa", "관리 페이지 2단계 인증", `
  <div class="tfa" id="tfa">
    <div class="tfa-ok" id="tfa-ok" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg><div><b>인증 앱이 등록되어 있습니다</b><span id="tfa-ok-sub"></span></div></div>
    <p id="tfa-status" class="muted">불러오고 있습니다</p>
    <div class="row" id="tfa-actions"></div>
    <div class="tfa-setup" id="tfa-setup" hidden>
      <div class="tfa-qr" id="tfa-qr" role="img" aria-label="인증 앱 QR 코드"></div>
      <div class="tfa-steps">
        <p class="muted">인증 앱(Google Authenticator, 1Password 등)으로 QR 을 찍거나 아래 키를 직접 넣습니다. 그다음 앱에 나온 6자리 코드를 입력하면 등록이 끝납니다. 끝내기 전까지는 지금 로그인 방식이 그대로입니다.</p>
        <div class="tfa-key" id="tfa-key"></div>
        <div class="row" style="margin-top:10px">
          <input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="확인 코드">
          <button type="button" class="primary" id="tfa-confirm">등록</button>
          <button type="button" id="tfa-cancel">취소</button>
        </div>
      </div>
    </div>
  </div>
  `, { open: true, meta: "인증 앱 코드" })}
  ${box("sec-password", "관리자 비밀번호", `
  <form class="tfa" id="ap-form" autocomplete="off">
    <p id="ap-status" class="muted">불러오고 있습니다</p>
    <div class="row">
      <input id="ap-current" type="password" autocomplete="current-password" placeholder="지금 비밀번호" aria-label="지금 비밀번호" maxlength="200">
      <input id="ap-new" type="password" autocomplete="new-password" placeholder="새 비밀번호 (12자 이상)" aria-label="새 비밀번호" minlength="12" maxlength="200">
      <input id="ap-new2" type="password" autocomplete="new-password" placeholder="새 비밀번호 한 번 더" aria-label="새 비밀번호 확인" maxlength="200">
    </div>
    <div class="row"><button class="primary" type="submit">비밀번호 정하기</button><button type="button" class="danger" id="ap-clear">여기서 정한 비밀번호 삭제</button></div>
  </form>
  `, { open: true, meta: "관리 페이지에 들어갈 때 넣는 비밀번호" })}
  </div>
  <div data-set-panel="tokens" hidden>${TOKENS_HTML}</div>
</section>

<section id="tab-logs" hidden>
  <div class="subtabs" id="logs-subtabs" role="tablist" aria-label="로그 종류">
    <button type="button" role="tab" data-lsub="xfer" aria-selected="true">${icon("download")}다운로드 기록</button>
    <button type="button" role="tab" data-lsub="client" aria-selected="false">${icon("device")}클라이언트 로그</button>
    <button type="button" role="tab" data-lsub="deny" aria-selected="false">${icon("lock")}차단과 거부</button>
  </div>
  <div data-logs-panel="xfer">${TRANSFERS_HTML}</div>
  <div data-logs-panel="client" hidden>
  <div class="hd"><h2 class="first">클라이언트 로그</h2><button type="button" id="cl-refresh">새로 고침</button></div>
  <p class="muted">CookingFoil 이 오류를 만나면 보내 온 기록입니다. 기기마다 최근 50개를 남깁니다.</p>
  ${box("bug-reports", "버그 리포트 순위", `<p class="muted">사용자가 직접 보낸 버그 리포트만 셉니다. 앱이 오류 때 스스로 보내는 기록은 세지 않습니다.</p>
  <div class="scroll" id="bug-reports" data-skel></div>`, { level: "h3", open: true })}
  <h3 class="sub-h">기기별 기록</h3>
  <div class="logs-view">
    <div class="logs-list" id="cl-list"></div>
    <div class="logs-body">
      <div class="logs-head" id="cl-head" hidden></div>
      <div class="logs-empty" id="cl-empty">${icon("log", "ico logs-empty-ico")}<b>기록을 고르면 여기에 내용이 나옵니다</b><span>왼쪽 기기에서 기록 하나를 누릅니다.</span></div>
      <pre id="cl-text" tabindex="0" hidden></pre>
    </div>
  </div>
  </div>
  <div data-logs-panel="deny" hidden>
  <div class="hd"><h2 class="first">차단된 IP</h2><button type="button" id="unlock-all">모두 해제</button></div>
  <div class="scroll" id="lockouts" data-skel></div>
  <div class="hd"><h2>거부 기록</h2><button type="button" id="clrdeny">기록 삭제</button></div>
  <p class="muted">서버가 거절한 요청과 그 이유입니다. 클라이언트가 말없이 실패할 때 여기에 남습니다.</p>
  <div class="scroll" id="denials" data-skel></div>
  </div>
</section>

<section id="tab-featured" hidden>
  <div class="hd"><h2 data-top="fp.h">추천</h2>
    <div class="actions"><button type="button" id="f-add" data-top="fp.addRow">추천 줄 추가</button>
    <button type="button" class="primary" id="f-save">저장</button></div></div>
  <p class="muted" data-top="fp.lead">CookingFoil 클라이언트의 홈 맨 위에 이 순서대로 줄이 나옵니다. 게임이 없는 줄은 보내지 않습니다. 저장하면 클라이언트가 다음에 목록을 받을 때 반영됩니다.</p>
  <div id="f-list"></div>
</section>

<section id="tab-library" hidden>
  <div class="hd"><h2>라이브러리</h2><button type="button" class="primary" id="rescan">다시 스캔</button></div>
  <p class="muted" id="scan-status" aria-live="polite"></p>
  <div class="subtabs" id="lib-subtabs" role="tablist" aria-label="라이브러리 구역">
    <button type="button" role="tab" data-lsub="files" aria-selected="true">${icon("folder")}파일</button>
    <button type="button" role="tab" data-lsub="organize" aria-selected="false">${icon("inbox")}임시 폴더</button>
    <button type="button" role="tab" data-lsub="verify" aria-selected="false">${icon("check")}검사</button>
    <button type="button" role="tab" data-lsub="patches" aria-selected="false">${icon("package")}패치</button>
    <button type="button" role="tab" data-lsub="saves" aria-selected="false">${icon("save")}세이브</button>
    <button type="button" role="tab" data-lsub="info" aria-selected="false">${icon("book")}이름과 소개</button>
    <button type="button" role="tab" data-lsub="server" aria-selected="false">${icon("sliders")}서버</button>
  </div>
  <div data-lib-panel="files">${LIB_BROWSER_HTML}
  <section class="lib-ops" aria-labelledby="lib-ops-h">
    <h3 class="sub-h" id="lib-ops-h">${top("ops.status")}</h3>
    <div class="cards" id="lib-cards"></div>
  </section></div>
  <div data-lib-panel="organize" hidden>${ORGANIZE_HTML}</div>
  <div data-lib-panel="verify" hidden>${LIBRARY_VERIFY_HTML}</div>
  <div data-lib-panel="patches" hidden>${PATCHES_HTML}</div>
  <div data-lib-panel="saves" hidden>${SAVES_HTML}</div>
  <div data-lib-panel="info" hidden>
  <h2 class="first">게임 이름, 소개, 추가 정보</h2>
  <p class="muted">소개는 titledb 가 새로 받아 오면 바뀔 수 있는 게임 설명이고, 직접 쓰면 그 글이 대신 나옵니다. 추가 정보는 운영자만 쓰는 안내(함께 설치할 것, 필요한 용량, 맞는 판, 오버클럭)로 자동 갱신이 건드리지 않습니다.</p>
  <form class="desc-form" id="gd-form">
    <label>${top("gp.find")}<input id="gd-game" autocomplete="off" ${topPh("gp.ph")}></label>
    <div id="gd-body" hidden>
      <h3>이름</h3>
      <p class="muted" id="gd-name-original"></p>
      <div class="ct-pair"><label>한국어<input id="gd-name-ko" maxlength="120" autocomplete="off"></label><label>영어 (다른 언어의 기본값)<input id="gd-name-en" maxlength="120" autocomplete="off"></label></div>
      ${GAME_PATCHES_HTML}
      <h3>추가 정보</h3>
      <label>한국어<textarea id="gd-notes-ko" maxlength="2000" placeholder="예: 게임 데이터 패치(약 49GB)를 함께 설치해야 실행됩니다."></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-notes-en" maxlength="2000"></textarea></label>
      <h3>소개</h3>
      <p class="muted" id="gd-original"></p>
      <label>한국어<textarea id="gd-ko" maxlength="2000"></textarea></label>
      <label>영어 (다른 언어의 기본값)<textarea id="gd-en" maxlength="2000"></textarea></label>
      <h3>${top("fp.detailH")}</h3>
      <div class="fp-detail"><label>${top("fp.detailRow")}<select id="gd-feat-row"></select></label>
        <label id="gd-feat-title-l" hidden>${top("fp.newTitle")}<input id="gd-feat-title" maxlength="40" autocomplete="off"></label>
        <button type="button" id="gd-feat-go">${top("fp.addTo")}</button></div>
      <div class="row-actions"><button type="submit" class="primary">저장</button><button type="button" id="gd-reset">소개를 titledb 것으로 되돌리기</button></div>
    </div>
  </form>
  </div>
  <div data-lib-panel="server" hidden>
  <h2 class="first">서버 설정</h2>
  <dl class="kv" id="settings"></dl>
  <p class="muted">바꿀 수 있는 설정은 <a href="#settings/server">설정 탭의 서버 동작</a>에 있습니다.</p>
  </div>
</section>

${RETRO_ART_HTML}
${ALERTS_HTML}
${INBOX_HTML}
${NSZ_HTML}
${TRASH_HTML}
<section id="tab-homebrew" hidden>
  <div class="subtabs" id="homebrew-subtabs" role="tablist" aria-label="홈브류 구역">
    <button type="button" role="tab" data-sub="apps" aria-selected="true">${icon("package")}앱</button>
    <button type="button" role="tab" data-sub="reco" aria-selected="false">${icon("star")}추천 홈브류</button>
    <button type="button" role="tab" data-sub="sources" aria-selected="false">${icon("download")}GitHub 저장소</button>
  </div>
  <div data-sub-panel="apps">
  <div class="hd"><h2 class="first">앱</h2><div class="actions"><button type="button" id="hb-rescan">다시 읽기</button><button type="button" id="hb-adopt">폴더 등록</button></div></div>
  <p class="muted">서버에 있는 홈브류 앱 전체입니다. 끄면 기기 목록에서 빠지고 서버에는 남습니다. GitHub 앱은 빼기로 더 따라가지 않고, 직접 넣은 앱은 GitHub 연결로 저장소를 따라가게 바꾸거나 삭제합니다.</p>
  ${box("hb-apps-help", "앱 관리 안내", `<p class="muted">앱마다 도구나 포트로 나누고, 그 앱의 패치와 세이브를 올리거나 삭제합니다. 서버의 홈브류 폴더에 .nro 와 게임 파일이 든 폴더를 직접 넣었다면 "폴더 등록"을 누르면 폴더째 등록됩니다.</p>`, { level: "h3" })}
  <div id="hb-held" class="hb-held" hidden></div>
  <div class="scroll" id="hb-apps" data-skel></div>
  </div>
  <div data-sub-panel="reco" hidden>
  <div class="hd"><h2 class="first">추천 홈브류</h2><div class="actions"><button type="button" id="hb-add-picked">고른 것 추가</button><button type="button" class="primary" id="hb-add-all">모두 추가</button></div></div>
  <p class="muted">최신 릴리스에서 바로 받을 수 있는 것을 확인한 목록입니다. 추가하면 서버가 GitHub 릴리스를 따라가며 새 버전을 알려 줍니다.</p>
  <div class="hb-reco" id="hb-reco" data-skel></div>
  </div>
  <div data-sub-panel="sources" hidden>
  <div class="hd"><h2 class="first">GitHub 저장소 추가</h2></div>
  <form class="add" id="hb-add">
    <input id="hb-repo" autocomplete="off" spellcheck="false" placeholder="GitHub 주소 또는 owner/name" aria-label="GitHub 저장소" required maxlength="200">
    <input id="hb-asset" autocomplete="off" spellcheck="false" placeholder="쓸 파일 이름 (선택, 예: *-classic.nro)" aria-label="쓸 파일 이름" maxlength="100">
    <button class="primary" type="submit">추가</button>
  </form>
  <p class="muted">추가하면 서버가 바로 확인해 최신 릴리스를 받아 둡니다. 릴리스에 .nro 가 여럿이면 저장소 이름과 같은 것을, 없으면 .zip 안의 .nro 를 씁니다. 다른 파일을 쓰려면 아래 목록에서 고릅니다.</p>
  <div class="hd"><h2>등록된 GitHub 저장소</h2><button type="button" id="hb-check-all">모두 지금 확인</button></div>
  <div class="scroll" id="hb-sources" data-skel></div>
  </div>
</section>

<section id="tab-upload" hidden>
  <div class="hd"><h2>${top("s.upload")}</h2></div>
  <p class="muted up-lead" id="up-lead">${top("u.lead")}</p>
  <div class="up-drop" id="up-drop" tabindex="0" role="button" data-top-label="u.dropAria" aria-label="올릴 파일 고르기">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
    <b id="up-drop-t">${top("u.dropT")}</b>
    <span id="up-chosen"></span>
    <div class="pick">
      <button type="button" id="up-file-btn">${top("u.pickFiles")}</button>
      <button type="button" id="up-dir-btn">${top("u.pickDir")}</button>
    </div>
    <input type="file" id="up-file" multiple hidden>
    <input type="file" id="up-dir" webkitdirectory hidden>
  </div>
  <div class="up-guess" id="up-guess" hidden>
    <p id="up-guess-t" aria-live="polite"></p>
    <button type="button" id="up-change">${top("u.change")}</button>
  </div>
  <div id="up-kinds" role="group" data-top-label="u.kindsAria" aria-label="올릴 곳" hidden>
  <p class="up-group">${top("u.grpSwitch")}</p>
  <div class="up-kinds">
    <button type="button" data-kind="game"><b>${top("u.kGame")}</b><span>${top("u.kGameD")}</span></button>
    <button type="button" data-kind="patch"><b>${top("u.kPatch")}</b><span>${top("u.kPatchD")}</span></button>
    <button type="button" data-kind="save"><b>${top("u.kSave")}</b><span>${top("u.kSaveD")}</span></button>
    <button type="button" data-kind="homebrew"><b>${top("u.kHomebrew")}</b><span>${top("u.kHomebrewD")}</span></button>
    <button type="button" data-kind="port"><b>${top("u.kPort")}</b><span>${top("u.kPortD")}</span></button>
    <button type="button" data-kind="client"><b>${top("u.kClient")}</b><span>${top("u.kClientD")}</span></button>
    <button type="button" data-kind="retro" data-pick="retro"><b>${top("u.kRetro")}</b><span>${top("u.kRetroD")}</span></button>
  </div>
  <div id="up-systems-wrap" hidden>
  <p class="up-group">${top("u.grpRetro")}</p>
  <div class="up-kinds up-systems" id="up-systems" data-skel></div>
  </div>
  </div>
  <p class="muted up-hint" id="up-hint"></p>
  <div id="up-note"></div>
  <form class="up" id="up-form" hidden>
    <label id="up-system-l" hidden>기종<select id="up-system"></select></label>
    <label id="up-target-l" hidden>대상<select id="up-target"><option value="">게임</option></select></label>
    <label id="up-game-l" hidden>${top("gp.find")}<input id="up-game" autocomplete="off" ${topPh("gp.ph")}></label>
    <label id="up-name-l" hidden>이름<input id="up-name" maxlength="100" autocomplete="off"></label>
    <label class="check" id="up-required-l" hidden><input type="checkbox" id="up-required"> 이 패치 없이는 게임이 실행되지 않습니다 (필수)</label>
    <label id="up-savetype-l" hidden>세이브 종류<select id="up-savetype"><option value="">백업 .meta 를 따르거나 어느 쪽에나 적용합니다</option><option value="device">본체 공용 세이브</option><option value="account">계정 세이브</option></select></label>
    <details class="up-more" id="up-desc-l" hidden><summary>설명 넣기 (선택)</summary>
      <label>영어 설명 (다른 언어의 기본값)<textarea id="up-desc" maxlength="2000"></textarea></label>
      <label>한국어 설명<textarea id="up-desc-ko" maxlength="2000"></textarea></label>
    </details>
    <p class="up-plan" id="up-plan"></p>
    <div class="bar" id="up-bar" hidden><i></i></div>
    <div class="up-go"><button type="submit" class="primary" id="up-go">${top("u.go")}</button><button type="button" id="up-clear">${top("u.reset")}</button><span class="muted" id="up-progress"></span></div>
  </form>
  <p class="muted up-foot">${top("u.foot")} <a href="#library">${top("up.seeFiles")}</a></p>
  <p class="up-sum" id="up-sum" role="status" aria-live="polite" hidden></p>
  <div class="up-log" id="up-log" role="list" data-top-label="u.resultsAria" aria-label="올린 결과"></div>
</section>
</div>

<dialog id="ask-dialog" class="ask" aria-labelledby="ask-text">
  <p id="ask-text"></p>
  <input id="ask-input" type="text" autocomplete="off" aria-labelledby="ask-text" hidden>
  <div class="dialog-actions"><button type="button" id="ask-no">취소</button><button type="button" id="ask-ok" class="primary">확인</button></div>
</dialog>
<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted">이 비밀번호는 지금만 볼 수 있습니다. 창을 닫기 전에 전달합니다.</p>
  <div class="cred" id="cred"></div>
  <p class="muted">CookingFoil 은 설정 파일을 sdmc:/switch/cookingfoil/config.json 에 넣으면 처음 연결할 때 이 아이디와 비밀번호로 한 번 확인해 QR 없이 승인합니다. 그다음부터는 기기 키로 접속합니다.</p>
  <div class="dialog-actions">
    <button type="button" id="cred-config">CookingFoil 설정 파일 다운로드</button>
    <button type="button" class="primary" id="cred-close">닫기</button>
  </div>
</dialog>
<dialog id="hb-banner" class="hb-banner" aria-labelledby="hb-banner-title">
  <h3 id="hb-banner-title"></h3>
  <p class="muted">게임처럼 앱 정보 위쪽에 넓은 배경 그림을, 아래에 스크린샷을 보여 줍니다. 포트는 배경을 SteamGridDB 에서, 스크린샷을 IGDB 에서(키가 있을 때) 자동으로 찾아 둡니다.</p>
  <h4>배경 그림</h4>
  <div class="hb-banner-now" id="hb-banner-now"><img id="hb-banner-img" alt="지금 그림"><p class="muted" id="hb-banner-none">지금은 그림이 없습니다.</p></div>
  <form class="add" id="hb-banner-search"><input id="hb-banner-q" aria-label="검색어" placeholder="영어 게임 이름"><button class="primary">SteamGridDB 에서 찾기</button></form>
  <p class="muted" id="hb-banner-state" aria-live="polite"></p>
  <div class="hb-banner-grid" id="hb-banner-results"></div>
  <div class="row-actions">
    <label class="btn-like" for="hb-banner-file">배경 올리기</label><input type="file" id="hb-banner-file" accept="image/*" hidden>
    <button type="button" id="hb-banner-remove" class="danger">배경 빼기</button>
  </div>
  <h4>스크린샷 <span class="muted" id="hb-shots-count"></span></h4>
  <div class="hb-shots" id="hb-shots"></div>
  <p class="muted" id="hb-shots-state" aria-live="polite"></p>
  <div class="dialog-actions">
    <label class="btn-like" for="hb-shots-file">스크린샷 올리기</label><input type="file" id="hb-shots-file" accept="image/*" multiple hidden>
    <button type="button" id="hb-shots-clear" class="danger">스크린샷 모두 빼기</button>
    <button type="button" id="hb-banner-close">닫기</button>
  </div>
</dialog>
<dialog id="hb-desc" aria-labelledby="hb-desc-title">
  <h3 id="hb-desc-title"></h3>
  <p class="muted" id="hb-desc-hint"></p>
  <form class="desc-form" id="hb-desc-form" method="dialog">
    <label>영어 설명 (모든 언어의 기본값)<textarea id="hb-desc-en" maxlength="2000"></textarea></label>
    <label>한국어 설명 (한국어로 볼 때)<textarea id="hb-desc-ko" maxlength="2000"></textarea></label>
    <div class="dialog-actions">
      <button type="button" id="hb-desc-reset">GitHub 기본값으로</button>
      <button type="button" id="hb-desc-close">닫기</button>
      <button type="submit" class="primary">저장</button>
    </div>
  </form>
</dialog>
${CONTENT_DIALOG_HTML}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${TOP_I18N_SCRIPT}${GRID_SCRIPT}${GAME_PICKER_SCRIPT}${DASHBOARD_SCRIPT}${INTEGRATIONS_SCRIPT}${RETRO_ART_SCRIPT}${ALERTS_SCRIPT}${PATCHES_SCRIPT}${LIBRARY_FILES_SCRIPT}${LIB_BROWSER_SCRIPT}${ORGANIZE_SCRIPT}${SERVER_SETTINGS_SCRIPT}${CLIENT_RELEASE_SCRIPT}${TOKENS_SCRIPT}${INBOX_SCRIPT}${NSZ_SCRIPT}${TRASH_SCRIPT}${TRANSFERS_SCRIPT}${ACTIVITY_SCRIPT}${POLISH_SCRIPT}${BOX_SCRIPT}${NAV_SCRIPT}</script></body></html>`;
}
