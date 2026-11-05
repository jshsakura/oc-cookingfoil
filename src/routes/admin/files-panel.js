/**
 * The admin file browser: the "파일" tab of each library page (games, retro, homebrew, patches, saves),
 * locked to that page's folder, over /admin/api/files (files-api.js). The folder path as links, a table
 * whose header stays under the page header, and a bar at the bottom that holds the selection's actions
 * and the pager. The folder lives in the address (?tab=folder&path=), so back, reload and links land on it.
 * The move dialog still has a root picker, so a move can cross folders. Rows pick like a desktop file
 * manager: a click picks one, Ctrl or Cmd adds, Shift takes a range, a double click or Enter opens, the
 * arrows walk the list, and a right click (or the menu key) opens a menu of what the pick allows. On a phone a
 * tap opens, a check box or a tap during a pick picks, and the pick's actions wait in the bottom bar. Rows dragged
 * onto a folder or the path move there; a pick or a folder comes down as one zip; images and text open in a preview.
 * Everything is scoped under #fb so it never restyles the rest of the page.
 */
import { icon } from "../../views/icons.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { EXPLORE_CSS, EXPLORE_SCRIPT } from "./files-explore.js";
import { LIBRARY_CSS, LIBRARY_SCRIPT } from "./files-library.js";

const ROOT_ICONS = { games: "grid", incoming: "inbox", retro: "joystick", homebrew: "package", patches: "puzzle", saves: "save" };

export const FILES_CSS = /* css */ `
#fb{display:flex;flex-direction:column;gap:12px}
#fb .fb-roots{display:flex;gap:6px;flex-wrap:wrap}
#fb .fb-roots button{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--panel);color:var(--muted);font-weight:700}
#fb .fb-roots button[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55);color:var(--text)}
#fb .fb-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
/* What can be done is always on the screen: an action that does not apply yet is dimmed, never hidden. A phone has no
   room for that: its bar holds what works now, in words, and a pick's actions move to the bottom bar. */
#fb .fb-cmds{container-type:inline-size;display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-height:38px}
#fb .fb-cmd{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 7px;border:0;border-radius:var(--r-md);background:none;color:var(--text);font-weight:var(--fw-bold);white-space:nowrap}
#fb .fb-cmd[hidden]{display:none}
#fb .fb-cmd .ico{width:16px;height:16px;flex:none}
#fb .fb-cmd:hover:not(:disabled){background:var(--sunk)}
#fb .fb-cmd:disabled{opacity:.35;cursor:default}
#fb .fb-cmd.danger:not(:disabled){color:var(--bad)}
#fb .fb-sep{width:1px;height:20px;margin:0 3px;background:var(--line)}
#fb .fb-nav .ib:disabled{opacity:.35;cursor:default}
/* A narrow window keeps the icons; the names stay as tooltips. */
@media (min-width:761px){@container (max-width:900px){#fb .fb-cmd:not(#fb-mkdir) span{display:none}#fb .fb-cmd:not(#fb-mkdir){padding:0 9px}}}
#fb thead [data-sort] span:last-child:not([data-top]){font-size:.7em;color:var(--muted);margin-left:4px}
#fb .fb-crumb{flex:1 1 320px;display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0;margin:0;padding:0;list-style:none}
#fb .fb-crumb li{display:flex;align-items:center;gap:2px;min-width:0}
#fb .fb-crumb li+li::before{content:"/";color:var(--faint);padding:0 4px}
#fb .fb-crumb button{border:0;background:none;padding:4px 6px;border-radius:var(--r-sm);color:var(--muted);font-weight:700;max-width:28ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-crumb button:hover{color:var(--text);background:var(--sunk)}
#fb .fb-crumb li:last-child button{color:var(--text)}
#fb .fb-q{position:relative;flex:0 1 280px;display:flex}
#fb .fb-q .ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
#fb .fb-q input{width:100%;padding-left:36px}
#fb .fb-wrap{border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel);overflow:clip}
/* overflow:visible undoes the admin tables' overflow:hidden, which would pin the header row to the table instead of the window. */
#fb table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;overflow:visible}
/* A row scrolled into view (a focus, a find) lands below the pinned header row, not under it. */
html:has(#fb){scroll-padding-top:calc(var(--adm-hdr-h,0px) + 48px);scroll-padding-bottom:72px}
/* A file list stays a table on a phone: the admin page's narrow-screen cards (dashboard-page.js) would stack each cell. */
#fb table{display:table}#fb thead{display:table-header-group}#fb tbody{display:table-row-group}
#fb tr,#fb tr:first-child:has(th){display:table-row;background:none;border:0;border-radius:0;margin:0;padding:0}
#fb td{display:table-cell;width:auto}#fb td::before{content:none}
#fb thead th{position:sticky;top:var(--adm-hdr-h,0px);z-index:2;background:var(--panel);border-bottom:1px solid var(--line);padding:0 10px;height:42px;text-align:left;font-size:var(--fs-xs);font-weight:700;color:var(--muted);white-space:nowrap}
#fb thead th button{border:0;background:none;padding:6px 0;color:inherit;font:inherit;display:inline-flex;gap:4px;align-items:center}
#fb thead th button[aria-sort]{color:var(--text)}
#fb td{padding:0 10px;height:48px;border-bottom:1px solid var(--line2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
#fb tbody tr:last-child td{border-bottom:0}
#fb tbody tr:hover td{background:var(--sunk)}
#fb tbody tr[aria-selected="true"] td{background:rgba(var(--accent-rgb),.10)}
#fb tbody tr{cursor:default}
#fb tbody tr:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
#fb-menu{position:fixed;z-index:60;min-width:200px;max-width:calc(100vw - 16px);padding:4px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);box-shadow:0 10px 28px var(--shadow);display:flex;flex-direction:column}
#fb-menu[hidden]{display:none}
#fb-menu button{display:flex;align-items:center;justify-content:flex-start;width:100%;height:auto;gap:10px;border:0;background:none;padding:9px 12px;border-radius:var(--r-md);text-align:left;color:var(--text);font-weight:var(--fw-bold);white-space:nowrap}
#fb-menu button:hover,#fb-menu button:focus-visible{background:var(--sunk);outline:0}
#fb-menu button .ico{color:var(--muted)}
#fb-menu button[data-danger]{color:var(--bad)}#fb-menu button[data-danger] .ico{color:var(--bad)}
#fb-menu .fb-m-head{margin:4px 12px 2px;font-size:var(--fs-xs)}
#fb .c-sel{width:44px;text-align:center}#fb .c-size{width:110px;text-align:right}#fb .c-mtime{width:180px}#fb .c-act{width:132px}
#fb .c-size,#fb .c-mtime{font-variant-numeric:tabular-nums;color:var(--muted)}
#fb .fb-shared{flex:none;display:inline-flex;color:var(--accent,var(--text))}#fb .fb-shared svg{width:15px;height:15px}
#fb-rows[aria-busy=true]:not(:has(.fb-skel)){opacity:.55;transition:opacity .15s .25s}
#fb th.c-size button{margin-left:auto}
#fb .fb-name{display:flex;align-items:center;gap:10px;min-width:0}
#fb .fb-name .ico{color:var(--muted)}#fb .fb-name .is-dir{color:var(--accent)}
#fb .fb-name button,#fb .fb-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-name button{border:0;background:none;padding:0;color:var(--text);font-weight:700;text-align:left}
#fb .fb-name button:hover{text-decoration:underline}
#fb .fb-id{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
/* While a folder loads, rows of the real shape wait in its place: the box, the icon, a name of some length, its size
   and date; in the grid, tiles. One light sweeps across all of them together (the gradient is fixed to the screen). */
#fb tr.fb-skel{pointer-events:none}
#fb .sk{display:block;height:12px;border-radius:var(--r-pill);background:linear-gradient(100deg,var(--line) 40%,color-mix(in srgb,var(--line) 40%,var(--panel)) 50%,var(--line) 60%) fixed;background-size:200vw 100%;animation:fb-sweep 1.4s linear infinite}
#fb .sk-box{width:18px;height:18px;border-radius:var(--r-xs)}
#fb .sk-ico{width:28px;height:28px;flex:none;border-radius:var(--r-sm)}
#fb .sk-name{display:flex;align-items:center;gap:10px}
#fb .sk-line{flex:0 1 auto}
#fb .sk-sm{width:44px;margin-left:auto}
#fb .sk-md{width:120px}
#fb.grid tr.fb-skel .sk-name{flex-direction:column;gap:10px}
#fb.grid tr.fb-skel .sk-ico{width:120px;height:120px;border-radius:var(--r-lg)}
#fb.grid tr.fb-skel .sk-line{width:70%!important}
@keyframes fb-sweep{from{background-position:100vw 0}to{background-position:-100vw 0}}
@media (prefers-reduced-motion:reduce){#fb .sk{animation:none}}
#fb .fb-act{display:flex;gap:6px;justify-content:flex-end}
#fb .fb-act button.ib{width:34px;height:34px;padding:0;position:relative}
#fb .fb-act button.ib>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#fb input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:var(--accent)}
#fb .fb-empty{padding:48px 16px;text-align:center;color:var(--muted)}
/* The bar holds to the window's bottom edge while the list runs past it, and ends the list when it does not. */
#fb .fb-foot{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:0;
  padding:8px 14px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px)}
#fb .fb-info{color:var(--muted);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
#fb .fb-foot[data-sel] .fb-info{color:var(--text);font-weight:700}
#fb .fb-sel-act{display:flex;gap:6px}#fb .fb-foot:not([data-sel]) .fb-sel-act{display:none}
#fb #fb-pick-all{display:none}
#fb .fb-pick-acts{display:none}
#fb .fb-note{display:none}
#fb .fb-name>button.fb-at{height:auto;padding:2px 0;border:0;background:none;color:var(--accent);font-size:var(--fs-xs);font-weight:400;text-align:left;text-decoration:underline;overflow:hidden;text-overflow:ellipsis}
/* 하위 폴더까지 widens a search, so it shows while there is something to search for. */
#fb .fb-bar:has(#fb-q:placeholder-shown) .fb-deep{display:none}
/* Files dragged over the list: the list is the target, outlined, with what dropping does said on it. */
#fb .fb-wrap{position:relative}
#fb .fb-drop{display:none;position:absolute;inset:0;z-index:4;place-items:center;border:2px dashed var(--accent);border-radius:inherit;
  background:color-mix(in srgb,var(--panel) 86%,transparent);color:var(--text);font-weight:700;pointer-events:none}
#fb.dragging .fb-drop{display:grid}
#fb .fb-wrap:has(.fb-empty:not([hidden])){min-height:160px}
#fb-file,#fb-dir{display:none}
/* The upload panel takes the bar's full width while files go up: a head line, then one row per file. */
#fb .fb-upl{flex:1 1 100%;order:-1;display:flex;flex-direction:column;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--line2)}
#fb .fb-upl[hidden]{display:none}
#fb .fb-u-head{display:flex;align-items:center;gap:8px}
#fb .fb-u-fold{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:0;background:none;padding:4px 0;text-align:left;color:var(--text)}
#fb .fb-u-fold .ico{transition:transform .15s;color:var(--muted)}#fb .fb-u-fold[aria-expanded="true"] .ico{transform:rotate(90deg)}
#fb .fb-up{font-weight:var(--fw-bold);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list{list-style:none;margin:0;padding:0;max-height:min(30vh,240px);overflow:auto;display:flex;flex-direction:column}
#fb .fb-u-list[hidden],#fb .fb-u-head button[hidden]{display:none}
#fb .fb-u-list li{display:grid;grid-template-columns:minmax(0,1fr) 120px 140px 30px;align-items:center;gap:10px;padding:3px 0;font-size:var(--fs-sm)}
#fb .fb-u-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list progress{width:100%;height:6px;accent-color:var(--accent)}
#fb .fb-u-st{color:var(--muted);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-u-list li[data-state="done"] .fb-u-st{color:var(--good)}#fb .fb-u-list li[data-state="fail"] .fb-u-st{color:var(--bad)}
#fb .fb-u-list button.ib{width:28px;height:28px;padding:0}
/* A folder row or a step of the path that rows dragged from the list would move into. */
#fb tbody tr.fb-target td{background:rgba(var(--accent-rgb),.18)}
#fb .fb-dragtip{position:fixed;z-index:60;pointer-events:none;padding:6px 12px;border-radius:var(--r-pill);background:var(--text);color:var(--bg);font-size:var(--fs-sm);font-weight:var(--fw-bold);white-space:nowrap;box-shadow:0 4px 16px var(--shadow)}
/* On the explorer the notice sits above the status bar it would cover. */
body:has(#fb) .toast{z-index:30;bottom:84px;max-width:min(720px,calc(100vw - 32px));border-radius:var(--r-lg)}
#fb .fb-crumb button.fb-target{background:rgba(var(--accent-rgb),.18);color:var(--text)}
#fb tbody tr[draggable="true"]{-webkit-user-drag:element}
#fb-view{width:min(960px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:none;flex-direction:column;gap:10px}
#fb-view[open]{display:flex}
#fb-view .fb-v-head{display:flex;align-items:center;gap:6px}
#fb-view h3{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb-view .ib{width:36px;height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}
#fb-view .fb-v-body{min-height:120px;overflow:auto;display:grid;place-items:center;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--sunk)}
#fb-view .fb-v-body img{max-width:100%;max-height:calc(100vh - 200px);object-fit:contain}
#fb-view .fb-v-body pre{place-self:stretch;margin:0;padding:12px 14px;font-size:var(--fs-sm);white-space:pre-wrap;word-break:break-all;max-height:calc(100vh - 200px);overflow:auto}
#fb-view .fb-v-note{margin:0;font-size:var(--fs-xs)}
#fb-view .fb-v-body img{cursor:zoom-in}
#fb-view .fb-v-body.fb-v-full{display:block;touch-action:auto}
#fb-view .fb-v-body.fb-v-full img{max-width:none;max-height:none;cursor:zoom-out}
#fb-move{width:min(560px,calc(100vw - 32px))}
#fb-tidy{width:min(760px,calc(100vw - 32px))}
#fb-tidy .fb-t-sum{margin:6px 0 12px;color:var(--muted);font-size:var(--fs-sm);line-height:1.6}
#fb-tidy .fb-t-list{list-style:none;margin:0 0 12px;padding:4px;max-height:min(55vh,480px);overflow:auto;border:1px solid var(--line);border-radius:var(--r-lg)}
#fb-tidy .fb-t-list:empty{display:none}
#fb-tidy .fb-t-list li{display:grid;gap:2px;padding:8px 10px;border-radius:var(--r-md);overflow-wrap:anywhere}
#fb-tidy .fb-t-list li+li{border-top:1px solid var(--line)}
#fb-tidy .fb-t-from{font-size:var(--fs-xs);color:var(--faint)}
#fb-tidy .fb-t-move .fb-t-from::after{content:" →"}
#fb-tidy .fb-t-art{display:block;font-size:var(--fs-xs);color:var(--faint)}
#fb-tidy .fb-t-to{font-size:var(--fs-sm);font-weight:var(--fw-bold);color:var(--text)}
#fb-tidy .fb-t-head{font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--muted);background:var(--sunk)}
#fb-tidy .fb-t-held .fb-t-to{font-weight:var(--fw);color:var(--muted)}
#fb-move .fb-roots{gap:4px}
#fb-move .fb-roots button{height:32px;padding:0 10px;font-size:var(--fs-sm)}
#fb-move .dialog-actions #fb-m-new{margin-right:auto}
#fb-move .fb-m-crumb{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin:8px 0;color:var(--muted);font-size:var(--fs-sm)}
#fb-move .fb-m-crumb button{border:0;background:none;padding:2px 4px;color:var(--muted);font-weight:700}
#fb-move .fb-m-list{max-height:min(50vh,420px);overflow:auto;border:1px solid var(--line);border-radius:var(--r-lg);margin:0 0 12px;padding:4px}
#fb-move .fb-m-list button{display:flex;width:100%;height:auto;justify-content:flex-start;align-items:center;gap:8px;border:0;background:none;padding:9px 10px;border-radius:var(--r-md);text-align:left;color:var(--text)}
#fb-move .fb-m-list button:hover{background:var(--sunk)}
#fb-move .fb-m-list .ico{color:var(--accent)}
#fb-move .fb-m-list p{margin:12px;color:var(--muted)}
/* A phone's top bar has no fixed height, so the header row scrolls with the table there. */
@media (max-width:899px){#fb thead th{position:static}#fb .fb-seg:has(#fb-t-tree){display:none}}
@media (max-width:760px){
  /* The header band is 60px on a phone: the column heads stay under it while the list scrolls. */
  #fb thead th{position:sticky;top:60px;z-index:2;background:var(--panel)}
  #fb thead th button{min-height:44px}
  /* A thumb's worth for what sits around the list. */
  #fb .fb-bar .fb-seg .ib,#fb .fb-bar .fb-nav .ib{width:44px;height:44px}
  #fb .fb-crumb button{min-height:44px}#fb .fb-addr-btn{display:none}
  #fb-rows tr{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
  #fb-view .fb-v-head button{min-width:44px;min-height:44px}
  #fb .fb-upl li{flex-wrap:wrap}#fb .fb-u-st{flex:1 1 100%;max-width:none;overflow:visible;white-space:normal;text-overflow:clip}
  /* A preview takes the screen, and fingers zoom it as they do any picture. */
  #fb-view{width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;inset:0;border:0;border-radius:0;box-sizing:border-box}
  #fb-view .fb-v-body{flex:1;min-height:0;touch-action:pinch-zoom}
  #fb-view .fb-v-body img{max-height:100%}#fb-view .fb-v-body pre{max-height:100%;align-self:stretch}
  #fb .c-mtime,#fb .c-act{display:none}#fb .c-size{width:72px}
  /* The browser has its own back and forward. The path takes the rest of the first line, the search and the view the second. */
  #fb .fb-nav #fb-back,#fb .fb-nav #fb-fwd{display:none}
  #fb .fb-crumb{flex:1 1 calc(100% - 112px);min-width:0}
  #fb .fb-q{flex:1 1 60%;order:1}
  /* What the row of commands held is in the bar at the bottom edge, where the thumb is. */
  #fb .fb-cmds{display:none}
  /* The name takes the row and whatever the row says about it goes under; the icon holds the left edge. */
  #fb:not(.grid) .fb-name{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;justify-items:start}
  #fb:not(.grid) .fb-name>:first-child{grid-row:1/span 6}
  #fb:not(.grid) .fb-name>*:not(:first-child){grid-column:2;max-width:100%}
  #fb:not(.grid) .fb-name>button,#fb:not(.grid) .fb-name>span:nth-child(2){white-space:normal;overflow-wrap:anywhere}
  /* A tap on a row decides what happens to it, so the name inside is not a second, different target. */
  #fb .fb-name>button:not(.fb-at){pointer-events:none}
  #fb .fb-name>button.fb-at{min-height:32px}
  #fb tbody tr{-webkit-touch-callout:none;user-select:none}
  #fb .fb-foot[data-sel] .fb-info{margin-right:auto}
  #fb .fb-foot[data-sel] .fb-pick-acts{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;flex:1 1 100%}
  #fb .fb-foot:not([data-sel]) .fb-pick-acts{display:flex;gap:4px;margin-left:auto}
  #fb .fb-foot:not([data-sel]) .fb-info{flex:1 1 0;min-width:0;font-size:var(--fs-xs)}
  #fb .fb-foot:not([data-sel]) .fb-pick-acts button{flex-direction:row;gap:6px;min-height:44px;padding:0 10px;font-size:var(--fs-sm);white-space:nowrap}
  #fb #fb-pick-all{display:inline-flex}
  #fb .fb-pick-acts button{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;height:auto;min-height:52px;padding:6px 2px;border:0;border-radius:var(--r-md);background:none;color:var(--text);font-size:var(--fs-xs);font-weight:var(--fw-bold);line-height:1.2;white-space:normal;overflow-wrap:anywhere}
  #fb .fb-pick-acts .ico{width:20px;height:20px;flex:none}
  #fb .fb-pick-acts button[data-danger]{color:var(--bad)}
  /* The bar has the screen's bottom edge to itself while a pick is held. */
  body:has(#fb-foot[data-sel]) .ch-launch{display:none}
  /* The chat button and a notice stand above the bar. */
  body:has(#fb-foot) .ch-launch{bottom:76px}
  body:has(#fb-foot):has(.ch-launch:not([hidden])) .wrap{padding-bottom:132px}
  body:has(#fb-foot) .toast{bottom:76px}
  /* The bar stays on the screen's bottom edge however short the list is, with room kept under the last row. */
  #fb .fb-foot{position:fixed;left:0;right:0;bottom:0;z-index:20;padding-bottom:calc(8px + env(safe-area-inset-bottom));background:var(--bg)}
  #fb{padding-bottom:72px}#fb:has(#fb-foot[data-sel]){padding-bottom:136px}
  /* The header already names the page, so the list starts sooner; 다시 스캔 moves to 파일 메뉴. */
  #tab-library:has(>[data-lib-panel="folder"]:not([hidden]))>.hd{display:none}
  /* While searching, 하위 폴더까지 takes the place of the view buttons instead of adding a line. */
  #fb .fb-bar:has(#fb-q:not(:placeholder-shown)) .fb-views{display:none}
  body:has(#fb-foot[data-sel]) .toast{bottom:136px}
  /* The menu is a sheet from the bottom edge, whatever the place it was opened from. */
  #fb-menu{left:0!important;right:0;top:auto!important;bottom:0;max-width:none;max-height:70dvh;overflow:auto;border-width:1px 0 0;border-radius:var(--r-xl) var(--r-xl) 0 0;padding:8px 8px calc(8px + env(safe-area-inset-bottom))}
  #fb-menu button{padding:13px 12px}
  #fb .fb-u-list li{grid-template-columns:minmax(0,1fr) 64px 30px}#fb .fb-u-list progress{display:none}
}
@media (prefers-reduced-motion:reduce){#fb *{transition:none!important}}
${EXPLORE_CSS}
${LIBRARY_CSS}
`;

/** Where a page puts its file browser; the split page swaps the marker for FOLDER_HTML (ids stay unique). */
export const FOLDER_MARK = "<!--folder-->";

export const FOLDER_HTML = `<div id="fb">
  <div class="fb-bar">
    <div class="fb-nav" role="group">
      <button type="button" class="ib" id="fb-back" ${topLabel("fb.back")} disabled>${icon("arrowleft")}</button>
      <button type="button" class="ib" id="fb-fwd" ${topLabel("fb.forward")} disabled>${icon("arrowright")}</button>
      <button type="button" class="ib" id="fb-upb" ${topLabel("fb.up")} disabled>${icon("arrowup")}</button>
      <button type="button" class="ib" id="fb-refresh" ${topLabel("fb.refresh")}>${icon("refresh")}</button>
    </div>
    <ol class="fb-crumb" id="fb-crumb" ${topLabel("fb.crumbLabel")}></ol>
    <button type="button" class="ib fb-addr-btn" id="fb-addr-btn" ${topLabel("fb.addrEdit")}>${icon("pencil")}</button>
    <input type="text" class="fb-addr" id="fb-addr" hidden autocomplete="off" spellcheck="false" ${topLabel("fb.crumbLabel")}>
    <label class="fb-q">${icon("search")}<input type="search" id="fb-q" autocomplete="off" spellcheck="false" maxlength="200" ${topPh("fb.qPh")} ${topLabel("fb.qPh")}></label>
    <label class="fb-deep"><input type="checkbox" id="fb-deep">${top("fb.deep")}</label>
    <div class="fb-views">
      <div class="fb-seg" role="group">
        <button type="button" class="ib" id="fb-v-list" aria-pressed="true" ${topLabel("fb.viewList")}>${icon("log")}</button>
        <button type="button" class="ib" id="fb-v-grid" aria-pressed="false" ${topLabel("fb.viewGrid")}>${icon("grid")}</button>
      </div>
      <div class="fb-seg" role="group">
        <button type="button" class="ib" id="fb-t-tree" aria-pressed="false" ${topLabel("fb.tree")}>${icon("folder")}</button>
        <button type="button" class="ib" id="fb-t-side" aria-pressed="false" ${topLabel("fb.side")}>${icon("info")}</button>
      </div>
    </div>
  </div>
  <div class="fb-cmds" role="toolbar" ${topLabel("fb.menu")}>
    <button type="button" class="fb-cmd" id="fb-mkdir">${icon("plus")}<span>${top("fb.newFolder")}</span></button>
    <i class="fb-sep"></i>
    <button type="button" class="fb-cmd fb-tidy" id="fb-tidy-btn" hidden>${icon("sparkles")}<span>${top("fb.tidy")}</span></button>
    <i class="fb-sep"></i>
    <button type="button" class="fb-cmd fb-onpick" id="fb-cut-btn">${icon("scissors")}<span>${top("fb.cut")}</span></button>
    <button type="button" class="fb-cmd fb-onpick" id="fb-copy-btn">${icon("copy")}<span>${top("fb.copy")}</span></button>
    <button type="button" class="fb-cmd" id="fb-paste-btn">${icon("clipboard")}<span>${top("fb.paste")}</span></button>
    <i class="fb-sep"></i>
    <button type="button" class="fb-cmd fb-onpick" id="fb-rename-btn">${icon("pencil")}<span>${top("fb.rename")}</span></button>
    <button type="button" class="fb-cmd fb-onpick" id="fb-move-btn">${icon("foldermove")}<span>${top("fb.move")}</span></button>
    <button type="button" class="fb-cmd fb-onpick" id="fb-zip-btn">${icon("download")}<span>${top("fb.download")}</span></button>
    <button type="button" class="fb-cmd fb-onpick" id="fb-share-btn">${icon("send")}<span>${top("fb.share")}</span></button>
    <button type="button" class="fb-cmd fb-onpick danger" id="fb-trash-btn">${icon("trash")}<span>${top("fb.trash")}</span></button>
    <i class="fb-sep"></i>
    <button type="button" class="fb-cmd" id="fb-undo-btn">${icon("undo")}<span>${top("fb.undo")}</span></button>
    <input type="file" id="fb-file" multiple tabindex="-1" aria-hidden="true">
    <input type="file" id="fb-dir" webkitdirectory multiple tabindex="-1" aria-hidden="true">
  </div>
  <div class="fb-body">
  <nav class="fb-tree" id="fb-tree" ${topLabel("fb.tree")}></nav>
  <div class="fb-main" id="fb-main">
  <div class="fb-wrap"><table>
    <thead><tr>
      <th class="c-sel"><input type="checkbox" id="fb-all" ${topLabel("fb.selectAll")}></th>
      <th class="c-name"><button type="button" data-sort="name">${top("fb.colName")}</button></th>
      <th class="c-size"><button type="button" data-sort="size">${top("fb.colSize")}</button></th>
      <th class="c-mtime"><button type="button" data-sort="mtime">${top("fb.colMtime")}</button></th>
      <th class="c-act"></th>
    </tr></thead>
    <tbody id="fb-rows"></tbody>
  </table><div class="fb-empty" id="fb-empty" hidden></div><div class="fb-drop" aria-hidden="true">${top("fb.dropHere")}</div></div>
  <div class="fb-more" id="fb-more"></div>
  </div>
  <aside class="fb-side" id="fb-side" ${topLabel("fb.side")} aria-live="polite"></aside>
  </div>
  <div id="fb-dragtip" class="fb-dragtip" hidden aria-hidden="true"></div>
  <div id="fb-menu" role="menu" hidden ${topLabel("fb.menu")}></div>
  <p class="muted fb-note">${top("fb.note")}</p>
  <div class="fb-foot" id="fb-foot">
    <span class="fb-info" id="fb-info" aria-live="polite"></span>
    <section class="fb-upl" id="fb-upl" hidden ${topLabel("fb.upPanel")}>
      <div class="fb-u-head">
        <button type="button" class="fb-u-fold" id="fb-up-fold" aria-expanded="true" aria-controls="fb-u-list">${icon("chevright")}<span class="fb-up" id="fb-up" aria-live="polite"></span></button>
        <button type="button" id="fb-up-stop">${top("fb.upStopAll")}</button>
        <button type="button" id="fb-up-close" hidden>${top("fb.close")}</button>
      </div>
      <ol class="fb-u-list" id="fb-u-list"></ol>
    </section>
    <div class="fb-sel-act">
      <button type="button" id="fb-pick-all">${top("fb.pickAll")}</button>
      <button type="button" id="fb-clear">${icon("x")}${top("fb.clear")}</button>
    </div>
    <span class="fb-job" id="fb-job" hidden><progress max="100" value="0"></progress><span aria-live="polite"></span></span>
    <div class="fb-pick-acts" id="fb-pick-acts"></div>
  </div>
</div>
<dialog id="fb-view" aria-labelledby="fb-v-title">
  <div class="fb-v-head">
    <h3 id="fb-v-title"></h3>
    <button type="button" class="ib" id="fb-v-prev" ${topLabel("fb.prevFile")}>${icon("chevleft")}</button>
    <button type="button" class="ib" id="fb-v-next" ${topLabel("fb.nextFile")}>${icon("chevright")}</button>
    <button type="button" class="ib" id="fb-v-dl" ${topLabel("fb.download")}>${icon("download")}</button>
    <button type="button" class="ib" id="fb-v-x" ${topLabel("fb.close")}>${icon("x")}</button>
  </div>
  <div class="fb-v-body" id="fb-v-body"></div>
  <p class="muted fb-v-note" id="fb-v-note" hidden></p>
</dialog>
<dialog id="fb-props" aria-labelledby="fb-p-title">
  <h3 id="fb-p-title"></h3>
  <div class="fb-p-box" id="fb-p-top"></div>
  <dl class="fb-p-list" id="fb-p-list"></dl>
  <div class="fb-p-box" id="fb-p-low"></div>
  <div class="dialog-actions"><button type="button" class="primary" id="fb-p-ok">${top("fb.close")}</button></div>
</dialog>
<div class="fb-lasso" id="fb-lasso" hidden></div>
<dialog id="fb-tidy" aria-labelledby="fb-t-title">
  <h3 id="fb-t-title">${top("fb.tidyTitle")}</h3>
  <p class="fb-t-sum" id="fb-t-sum" aria-live="polite"></p>
  <ol class="fb-t-list" id="fb-t-list"></ol>
  <div class="dialog-actions"><button type="button" id="fb-t-no">${top("fb.cancel")}</button><button type="button" class="primary" id="fb-t-ok">${top("fb.tidy")}</button></div>
</dialog>
<dialog id="fb-move" aria-labelledby="fb-m-title">
  <h3 id="fb-m-title">${top("fb.moveTitle")}</h3>
  <div class="fb-roots" id="fb-m-roots" role="group" ${topLabel("fb.rootsLabel")}></div>
  <div class="fb-m-crumb" id="fb-m-crumb"></div>
  <div class="fb-m-list" id="fb-m-list"></div>
  <div class="dialog-actions"><button type="button" id="fb-m-new">${icon("plus")}${top("fb.newFolder")}</button><button type="button" id="fb-m-no">${top("fb.cancel")}</button><button type="button" class="primary" id="fb-m-ok">${top("fb.moveHere")}</button></div>
</dialog>`;

export const FILES_SCRIPT = /* js */ `
const FB_ICON=${JSON.stringify({ dir: icon("folder", "ico is-dir"), file: icon("file"), up: icon("chevleft"), chev: icon("chevright"), open: icon("folder"), download: icon("download"), share: icon("send"), rename: icon("pencil"), move: icon("foldermove"), trash: icon("trash"), mkdir: icon("plus"), tidy: icon("sparkles"), refresh: icon("refresh"), upload: icon("upload"), stop: icon("x"), zip: icon("package"), view: icon("image"), cut: icon("scissors"), copy: icon("copy"), paste: icon("clipboard"), undo: icon("undo"), props: icon("info"), more: icon("more"), nsz: icon("shrink"), verify: icon("check"), ...Object.fromEntries(Object.entries(ROOT_ICONS).map(([k, v]) => [k, icon(v)])) })};
const FB_PER=100;
const FB_SKEL_MS=120;
// Keys stay with a field being typed in or a dialog, but a pick's check box is part of the list.
const FB_NOT_KEYS='input:not([type=checkbox]),textarea,select,dialog';
const FB_MAX_PAGES=5;
const fb={roots:[],root:'',path:'',sort:'mtime',order:'desc',q:'',sel:new Set(),anchor:null,focus:null,drag:null,hi:0,hmax:0,deep:null,clip:null,undos:[],redos:[],seq:0,data:null,timer:null};
const fbSize=(n)=>{if(n==null)return '';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+u[i];};
const fbDate=(ms)=>ms?new Date(ms).toLocaleString(loc(),{dateStyle:'medium',timeStyle:'short'}):'';
const fbRootName=(k)=>topText('fb.root.'+k);
const fbPhone=()=>matchMedia('(max-width:760px)').matches;
// fb.deep is null until someone decides: a search that finds nothing here then looks further down by itself.
function fbDeepReset(){fb.deep=null;$('fb-deep').checked=false;}
function fbUrl(){const u=new URL(location.href);u.searchParams.delete('root');u.searchParams.delete('view');u.searchParams.set('tab','folder');
  if(fb.path)u.searchParams.set('path',fb.path);else u.searchParams.delete('path');return u.pathname+u.search+u.hash;}
function fbGo(root,path,{push=true}={}){fb.root=root;fb.path=path||'';fb.q='';$('fb-q').value='';fbDeepReset();fb.sel.clear();fb.anchor=fb.focus=null;
  if(push&&location.pathname+location.search+location.hash!==fbUrl()){fb.hi++;fb.hmax=fb.hi;history.pushState({fbi:fb.hi},'',fbUrl());}fbPaint();fbLoad();}
function fbRootButtons(mount,current,pick){mount.replaceChildren();for(const r of fb.roots){const b=el('button');b.type='button';
  b.innerHTML=FB_ICON[r.key]||'';b.append(el('span',fbRootName(r.key)));b.setAttribute('aria-pressed',String(r.key===current));
  b.addEventListener('click',()=>pick(r.key));mount.append(b);}}
function fbCrumb(mount,root,path,go){mount.replaceChildren();const parts=path?path.split('/'):[];
  const add=(label,to)=>{const li=el('li');const b=el('button',label);b.type='button';b.title=label;b.addEventListener('click',()=>go(to));
    if(to!==path)fbDropTarget(b,()=>to);li.append(b);mount.append(li);};
  add(fbRootName(root),'');parts.forEach((p,i)=>add(p,parts.slice(0,i+1).join('/')));}
function fbSortHeads(){for(const b of document.querySelectorAll('#fb thead [data-sort]')){const on=b.dataset.sort===fb.sort;
  if(on)b.setAttribute('aria-sort',fb.order==='asc'?'ascending':'descending');else b.removeAttribute('aria-sort');
  b.dataset.arrow=on?(fb.order==='asc'?'▲':'▼'):'';const t=b.querySelector('[data-top]');b.replaceChildren(t||b.firstChild);if(on)b.append(el('span',fb.order==='asc'?'▲':'▼'));}}
const FB_HOLD_MS=500,FB_HOLD_SLOP=10,FB_HOLD_BUZZ=20;
function fbRow(f){const tr=el('tr');tr.dataset.rel=f.rel;tr.setAttribute('aria-selected',String(fb.sel.has(f.rel)));tr.tabIndex=f.rel===fb.focus?0:-1;
  const cs=td(null,'c-sel');const cb=el('input');cb.type='checkbox';cb.checked=fb.sel.has(f.rel);cb.setAttribute('aria-label',topFill('fb.selectRow',{name:f.name}));
  cb.addEventListener('change',()=>{if(cb.checked)fb.sel.add(f.rel);else fb.sel.delete(f.rel);fb.anchor=fb.focus=f.rel;fbPaint();});cs.append(cb);
  const onControl=(e)=>e.target.closest('button,input,a');
  // Shift and double clicks pick rows; without this they would also select the text under the pointer.
  tr.addEventListener('mousedown',(e)=>{if(!onControl(e)&&(e.shiftKey||e.detail>1))e.preventDefault();});
  // A finger held on a row picks it, as a phone's own file apps do; a slide or an early lift is a scroll or a tap.
  let hold=null,from=null;const letGo=()=>{clearTimeout(hold);hold=null;};
  tr.addEventListener('touchstart',(e)=>{fb.held=null;letGo();if(!fbPhone()||e.touches.length!==1||e.target.closest('input,a'))return;from=e.touches[0];
    hold=setTimeout(()=>{hold=null;fb.held=f.rel;if(!fb.sel.has(f.rel))fbPick(f.rel,{add:true});navigator.vibrate?.(FB_HOLD_BUZZ);},FB_HOLD_MS);},{passive:true});
  tr.addEventListener('touchmove',(e)=>{if(hold&&Math.hypot(e.touches[0].clientX-from.clientX,e.touches[0].clientY-from.clientY)>FB_HOLD_SLOP)letGo();},{passive:true});
  tr.addEventListener('touchend',letGo);tr.addEventListener('touchcancel',letGo);
  // What follows a hold is not a tap, also on the folder's name, which opens by its own click.
  tr.addEventListener('click',(e)=>{if(fb.held===f.rel){fb.held=null;e.preventDefault();e.stopPropagation();}},true);
  tr.addEventListener('click',(e)=>{if(onControl(e))return;if(fbPhone())fbTap(f,e);else fbPick(f.rel,{add:e.ctrlKey||e.metaKey,range:e.shiftKey});});
  tr.addEventListener('dblclick',(e)=>{if(!onControl(e)&&!fbPhone())fbActivate(f);});
  // A phone's browser ends the touch with its own long press, sometimes before the timer: that is the same hold.
  tr.addEventListener('contextmenu',(e)=>{e.preventDefault();if(fbPhone()){letGo();if(fb.held!==f.rel){fb.held=f.rel;if(!fb.sel.has(f.rel))fbPick(f.rel,{add:true});}return;}if(!fb.sel.has(f.rel))fbPick(f.rel);fbMenu(e.clientX,e.clientY);});
  tr.draggable=!fbPhone();tr.addEventListener('dragstart',(e)=>fbDragStart(e,f.rel));
  if(f.type==='dir')fbDropTarget(tr,()=>!fb.drag?.includes(f.rel)&&f.rel);
  const cn=td(null,'c-name');const n=el('div',null,'fb-name');const ic=el('span');ic.innerHTML=f.type==='dir'?FB_ICON.dir:FB_ICON.file;n.append(ic.firstChild);
  // A title id folder reads as its game, the id beside it; a file keeps its own name first.
  if(f.type==='dir'){const b=el('button',f.title||f.name);b.type='button';b.title=f.title?f.title+' ('+f.name+')':f.name;b.addEventListener('click',()=>fbGo(fb.root,f.rel));n.append(b);if(f.title)n.append(el('span',f.name,'fb-id'));}
  else{const s=el('span',f.name);s.title=f.name;n.append(s);if(f.title)n.append(el('span',f.title,'fb-where'));}
  // A search through folders below names where each find is.
  const at=f.rel.split('/').slice(0,-1).join('/');if(fb.data?.deep&&at!==fb.path){const w=el('button',at,'fb-where fb-at');w.type='button';w.title=at;w.addEventListener('click',()=>{fb.reveal=f.rel;fbGo(fb.root,at);});n.append(w);}
  fbDecorate(n,f);if(f.shared){const w=el('span',null,'fb-shared');w.innerHTML=FB_ICON.share;w.title=topText('fb.sharedRow');w.setAttribute('aria-label',topText('fb.sharedRow'));w.setAttribute('role','img');n.append(w);}
  cn.append(n);if(fbClipped(f.rel))tr.classList.add('fb-cut');
  const ca=td(null,'c-act');const act=el('div',null,'fb-act');
  act.append(tbtn('rename','fb.rename',()=>fbRename(f)));
  if(f.type==='file'){const d=tbtn('download','fb.download',()=>fbDownload(f));d.classList.add('fb-dl');act.append(d);}
  act.append(tbtn('delete','fb.trash',()=>fbTrash([f.rel]),'danger'));ca.append(act);
  tr.append(cs,cn,td(f.type==='dir'?fbDirSize(f):fbSize(f.size),'c-size'),td(fbDate(f.mtime),'c-mtime'),ca);return tr;}
const fbRels=()=>fb.data?fb.data.items.map((f)=>f.rel):[];
const fbItem=(rel)=>fb.data?.items.find((f)=>f.rel===rel);
function fbDownload(f){location.href='/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel});}
function fbActivate(f){if(f.type==='dir')fbGo(fb.root,f.rel);else if(fbKind(f))fbView(f);else fbDownload(f);}
// A tap opens a folder or a preview. Anything else only gets picked, because a game file opened by a slip would start a download of many gigabytes.
function fbTap(f,e){const opens=f.type==='dir'||fbKind(f);if(e.target.closest('.c-sel')||fb.sel.size)fbPick(f.rel,{add:true});else if(opens)fbActivate(f);else{fbPick(f.rel,{add:true});toast(topText('fb.noView'));}}
function fbParent(){if(fb.path)fbGo(fb.root,fb.path.split('/').slice(0,-1).join('/'));}
// The rows show fb.sel and the one focusable row (fb.focus); every pick goes through here.
function fbPaint(){for(const r of document.querySelectorAll('#fb-rows tr')){const on=fb.sel.has(r.dataset.rel);
    r.setAttribute('aria-selected',String(on));r.tabIndex=r.dataset.rel===fb.focus?0:-1;const cb=r.querySelector('input[type=checkbox]');if(cb)cb.checked=on;}
  fbFoot();}
function fbPick(rel,{add=false,range=false}={}){const rels=fbRels();
  if(range&&fb.anchor&&rels.includes(fb.anchor)){const a=rels.indexOf(fb.anchor),b=rels.indexOf(rel);if(!add)fb.sel.clear();
    for(const r of rels.slice(Math.min(a,b),Math.max(a,b)+1))fb.sel.add(r);}
  else if(add){if(fb.sel.has(rel))fb.sel.delete(rel);else fb.sel.add(rel);fb.anchor=rel;}
  else{fb.sel.clear();fb.sel.add(rel);fb.anchor=rel;}
  fb.focus=rel;fbPaint();}
function fbFocusRow(){for(const r of document.querySelectorAll('#fb-rows tr'))if(r.dataset.rel===fb.focus){r.focus();r.scrollIntoView({block:'nearest'});return;}}
function fbCmds(){const n=fb.sel.size;for(const id of ['fb-cut-btn','fb-copy-btn','fb-move-btn','fb-zip-btn','fb-trash-btn'])$(id).disabled=!n||!!fb.busy;
  for(const b of $('fb-pick-acts').children)b.disabled=!!fb.busy;
  const one=n===1?fbItem([...fb.sel][0]):null;$('fb-rename-btn').disabled=!one;$('fb-share-btn').disabled=!one;$('fb-tidy-btn').hidden=fb.root==='incoming';$('fb-paste-btn').disabled=!fb.clip;$('fb-undo-btn').disabled=!fb.undos.length;}
function fbFoot(){fbCmds();const d=fb.data;const foot=$('fb-foot');const n=fb.sel.size;
  if(n)foot.dataset.sel='';else delete foot.dataset.sel;
  $('fb-info').textContent=n?topFill('fb.selected',{n:num(n)}):d?topFill('fb.counts',{dirs:num(d.counts.dirs),files:num(d.counts.files)}):'';
  const rows=[...document.querySelectorAll('#fb-rows tr')];const all=$('fb-all');
  all.checked=rows.length>0&&rows.every((r)=>fb.sel.has(r.dataset.rel));all.indeterminate=!all.checked&&rows.some((r)=>fb.sel.has(r.dataset.rel));
  if(!n&&d&&d.items.length<d.total)$('fb-info').textContent+=' · '+topFill('fb.shown',{shown:num(d.items.length)});
  fbPickBar();fbSide();}
// Placeholder rows while another folder, page or search loads; a refresh of the same view keeps its rows.
const FB_SKEL_W=[62,44,71,38,55,67,48,59,41,64];
function fbSkel(){$('fb-empty').hidden=true;const sk=(cls,w)=>{const i=el('i',null,'sk '+cls);if(w)i.style.width=w+'%';return i;};
  $('fb-rows').replaceChildren(...FB_SKEL_W.map((w)=>{const tr=el('tr',null,'fb-skel');tr.setAttribute('aria-hidden','true');
    const name=el('span',null,'sk-name');name.append(sk('sk-ico'),sk('sk-line',w));const n=td(null);n.append(name);
    const sel=td(null,'c-sel');sel.append(sk('sk-box'));const size=td(null,'c-size');size.append(sk('sk-sm'));const at=td(null,'c-mtime');at.append(sk('sk-md'));
    tr.append(sel,n,size,at,td(null,'c-act'));return tr;}));}
// The first page; the rest come as the list scrolls (fbMore).
// A refresh of the same view asks for as many rows as were shown, so the list does not shrink under the reader.
// What the server makes at the top of a folder (the retro pictures, the RetroArch pack, its lists) stays out of the
// list until the switch shows it; the choice is kept in this browser.
// Moving or deleting what the server keeps can change the retro pages or what consoles get: it asks first.
async function fbServerOk(rels,root=fb.root){if(root!==fb.root||!fb.data)return true;
  const ours=new Set(fb.data.items.filter((f)=>f.server).map((f)=>f.rel));
  return !rels.some((r)=>ours.has(r))||await ask(topText('fb.serverAsk'),{danger:true});}
async function fbLoad(){if(!fb.root)return;const n=++fb.seq;fb.moreBusy=false;
  const qs=new URLSearchParams({root:fb.root,path:fb.path,sort:fb.sort,order:fb.order});if(fb.q)qs.set('q',fb.q);if(fb.q&&fb.deep)qs.set('deep','1');
  fbNav();fbCrumb($('fb-crumb'),fb.root,fb.path,(to)=>fbGo(fb.root,to));fbSortHeads();
  const view=fb.root+'|'+qs;const pages=view===fb.view&&fb.data?Math.min(FB_MAX_PAGES,Math.max(1,fb.data.page)):1;
  qs.set('page','1');qs.set('perPage',String(FB_PER*pages));$('fb-rows').setAttribute('aria-busy','true');const skel=view!==fb.view?setTimeout(()=>{if(n===fb.seq)fbSkel();},FB_SKEL_MS):null;
  let d;try{d=await api('/admin/api/files/list?'+qs);}catch(err){clearTimeout(skel);if(n!==fb.seq)return;$('fb-rows').removeAttribute('aria-busy');
    // The server out of reach says nothing about the folder: what is on screen and the pick stay.
    if(err.offline&&view===fb.view&&fb.data){toast(err.message);return;}
    // A folder that is gone (moved elsewhere, a stale link) leads back to the top of its storage.
    if(err.code==='not-found'&&fb.path){toast(err.message);const back=fb.good?.root===fb.root&&fb.good.path!==fb.path?fb.good.path:'';
      fbGo(fb.root,back,{push:false});history.replaceState({fbi:fb.hi},'',fbUrl());return;}
    fb.data=null;$('fb-rows').replaceChildren();const e=$('fb-empty');e.hidden=false;e.textContent=topFill('fb.loadFail',{msg:err.message});fbFoot();return;}
  clearTimeout(skel);if(n!==fb.seq)return;$('fb-rows').removeAttribute('aria-busy');
  if(fb.q&&fb.deep===null&&!d.total){fb.deep=true;$('fb-deep').checked=true;await fbLoad();if(fb.data?.items.length)toast(topText('fb.widened'));return;}
  d.page=pages;d.pages=Math.max(1,Math.ceil(d.total/FB_PER));fb.data=d;fb.view=view;fb.good={root:fb.root,path:fb.path};
  const live=new Set(d.items.map((f)=>f.rel));for(const r of [...fb.sel])if(!live.has(r))fb.sel.delete(r);
  if(!live.has(fb.focus))fb.focus=d.items[0]?.rel??null;if(!live.has(fb.anchor))fb.anchor=null;
  const found=fb.reveal&&live.has(fb.reveal)?fb.reveal:null;fb.reveal=null;if(found){fb.sel.add(found);fb.anchor=fb.focus=found;}
  $('fb-rows').replaceChildren(...d.items.map(fbRow));
  const e=$('fb-empty');e.hidden=d.items.length>0;e.textContent=fb.q?topText(d.deep?'fb.noMatchDeep':'fb.noMatch'):topText('fb.empty');fbFoot();if(found)fbFocusRow();
  if(d.cut)toast(topText('fb.deepCut'));fbThumbs();fbTreeSync();fbSizeRows(d.items);}
const fbExt=(name)=>(/\\.[^./]+$/.exec(name)?.[0]||'').toLowerCase();
// What a rename usually retypes: a game's [id][version] and the extension stay out of the selection.
function fbStem(f){const ext=f.name.length-(f.type==='file'?fbExt(f.name).length:0);const tag=f.name.search(/ ?[[]/);return tag>0?Math.min(tag,ext):ext;}
async function fbRename(f){if(!await fbServerOk([f.rel]))return;const name=await askText(topText('fb.renameAsk'),f.name,{selectTo:fbStem(f)});if(name==null||!name.trim()||name.trim()===f.name)return;
  if(f.type==='file'&&!/^[.]|[/]/.test(name.trim())&&fbExt(name.trim())!==fbExt(f.name)&&!await ask(topText('fb.extAsk')))return;
  try{await fbStep(fbPost('rename',{root:fb.root,path:f.rel,name:name.trim()}),(out)=>({journal:[out.undo]}));fb.sel.delete(f.rel);
    fbToastUndo(topText('fb.renamed'));fbLoad();}catch(err){toast(err.message);}}
// 파일 압축 and 파일 검사 hand the picked files, or every game file under the picked folders, to the queues the 파일 압축 and 파일 검사 tabs show.
async function fbNsz(rels){try{const out=await api('/admin/api/nsz/run-selected',{method:'POST',body:{rels}});toast(topFill('nz.runSelGo',{n:num(out.count)}));}catch(err){toast(err.message);}}
async function fbVerify(rels){try{await api('/admin/api/library/verify/recheck',{method:'POST',body:{rels}});toast(topText('lv.rechecking'));}catch(err){toast(err.message);}}
// A step on many files says so while it runs and shuts the buttons, so the same pick cannot go twice. A quick one shows nothing.
const FB_BUSY_SHOW_MS=250;
const fbStillBusy=()=>{if(fb.busy)toast(topText('fb.busyNow'));return !!fb.busy;};
async function fbBusyRun(text,run){fb.busy=true;fbCmds();const box=$('fb-job');const bar=box.querySelector('progress');
  const show=setTimeout(()=>{bar.removeAttribute('value');box.querySelector('span').textContent=text;box.hidden=false;},FB_BUSY_SHOW_MS);
  try{return await run();}finally{clearTimeout(show);box.hidden=true;bar.value=0;fb.busy=false;fbCmds();}}
// A folder's weight is what the question has to say: "1 item" may be forty files.
async function fbTrashAsk(rels){const dirs=rels.filter((r)=>fbItem(r)?.type==='dir');let inside=0;
  if(dirs.length)try{inside=await fbHolds(fb.root,dirs);}catch{inside=0;}
  return inside?topFill('fb.askTrashIn',{n:num(rels.length),f:num(inside)}):topFill('fb.askTrash',{n:num(rels.length)});}
async function fbTrash(rels){if(!rels.length||fbStillBusy()||!await fbServerOk(rels))return;
  if(!await ask(await fbTrashAsk(rels),{danger:true}))return;
  try{const out=await fbBusyRun(topFill('fb.trashing',{n:num(rels.length)}),()=>fbStep(fbPost('trash',{root:fb.root,paths:rels}),(o)=>({restore:o.restore})));for(const r of rels)fb.sel.delete(r);
    fbToastUndo(topFill('fb.trashed',{n:num(out.files.length)}));fbLoad();}catch(err){toast(err.message);}}
async function fbMkdir(){const name=await askText(topText('fb.newFolderAsk'),'');if(name==null||!name.trim())return;
  try{await fbStep(fbPost('mkdir',{root:fb.root,path:fb.path,name:name.trim()}),(o)=>({trash:{root:o.root,paths:[o.rel]},held:0}));toast(topText('fb.made'));fbLoad();}catch(err){toast(err.message);}}
// Upload into the open folder: files dropped on the list (a dropped folder keeps its shape) or picked with the
// buttons go up one at a time in pieces (chunkUpload, common-script.js) and land where the list was when they were
// picked. A name the folder already has asks before a byte goes up: skip, keep both, or replace, where the old file
// goes to the trash and the undo brings it back. The panel in the bottom bar lists every file with its progress and a stop button; a stopped file sent again picks up where it was.
const fbu={busy:false,items:[],placed:0,skipped:0,taken:null};
async function fbEntries(entry,prefix,out){
  if(entry.isFile){out.push({file:await new Promise((ok,no)=>entry.file(ok,no)),rel:prefix+entry.name});return;}
  if(!entry.isDirectory)return;const reader=entry.createReader();
  for(;;){const batch=await new Promise((ok,no)=>reader.readEntries(ok,no));if(!batch.length)break;
    for(const e of batch)await fbEntries(e,prefix+entry.name+'/',out);}}
async function fbDropped(dt){const out=[];const entries=[];
  for(const it of dt.items||[]){if(it.kind!=='file')continue;const e=it.webkitGetAsEntry&&it.webkitGetAsEntry();if(e)entries.push(e);else{const f=it.getAsFile();if(f)out.push({file:f,rel:f.name});}}
  for(const e of entries)await fbEntries(e,'',out);
  if(!out.length&&dt.files)for(const f of dt.files)out.push({file:f,rel:f.name});
  return out;}
const FB_UP_LIVE=new Set(['wait','up']);
function fbUpItem(it){const li=el('li');li.dataset.state=it.state;
  const name=el('span',it.rel,'fb-u-name');name.title=it.rel;const bar=el('progress');bar.max=1;bar.value=0;
  const st=el('span','','fb-u-st');const stop=el('button');stop.type='button';stop.className='ib';stop.innerHTML=FB_ICON.stop;
  stop.setAttribute('aria-label',topFill('fb.upStop',{name:it.rel}));stop.addEventListener('click',()=>fbUpStop(it));
  const again=el('button',null,'ib fb-u-again');again.type='button';again.innerHTML=FB_ICON.upload;
  again.setAttribute('aria-label',topFill('fb.upResume',{name:it.rel}));again.addEventListener('click',()=>fbUpResume(it));
  li.append(name,bar,st,stop,again);it.li=li;it.bar=bar;it.st=st;it.stop=stop;it.again=again;fbUpPaint(it);return li;}
function fbUpPaint(it){const li=it.li;if(!li)return;li.dataset.state=it.state;it.bar.value=it.file.size?it.sent/it.file.size:it.state==='done'?1:0;
  it.st.textContent=it.state==='up'?Math.floor(it.bar.value*100)+'%':it.state==='fail'?it.msg:topText('fb.st.'+it.state);
  it.st.title=it.st.textContent;it.stop.hidden=!FB_UP_LIVE.has(it.state);it.again.hidden=!FB_UP_AGAIN.has(it.state);}
// The panel's head line: how far the whole batch is, and the buttons that fit (stop all while busy, close after).
function fbUpShow(){const box=$('fb-upl');const all=fbu.items;box.hidden=!all.length;if(!all.length)return;
  const bytes=all.reduce((a,it)=>a+it.file.size,0)||1,sent=all.reduce((a,it)=>a+(it.state==='done'?it.file.size:it.sent),0);
  const finished=all.filter((it)=>!FB_UP_LIVE.has(it.state)).length;
  const done=all.filter((it)=>it.state==='done').length;
  $('fb-up').textContent=fbu.busy?topFill('fb.uploading',{n:num(Math.min(finished+1,all.length)),t:num(all.length),p:String(Math.floor(sent/bytes*100))}):finished>done?topFill('fb.upHead',{n:num(done),s:num(finished-done)}):topFill('fb.upDone',{n:num(done)});
  $('fb-up-stop').hidden=!fbu.busy;$('fb-up-close').hidden=fbu.busy;}
function fbUpload(items,path=fb.path){if(!items.length||!fb.root)return;const at={root:fb.root,path};
  const list=$('fb-u-list');
  for(const x of items){const it={...x,...at,state:'wait',sent:0,ctl:new AbortController()};fbu.items.push(it);list.append(fbUpItem(it));}
  fbUpShow();if(!fbu.busy)fbUpRun();}
function fbUpStop(it){if(!FB_UP_LIVE.has(it.state))return;it.state='stop';it.ctl.abort();fbUpPaint(it);fbUpShow();}
// The server kept the pieces that landed, so sending the same file again starts after them.
const FB_UP_AGAIN=new Set(['stop','fail']);
function fbUpResume(it){if(!FB_UP_AGAIN.has(it.state))return;it.state='wait';it.msg='';it.ctl=new AbortController();fbUpPaint(it);fbUpShow();if(!fbu.busy)fbUpRun();}
// What to do with a name the folder already has; "the rest too" answers once for the whole batch.
async function fbUpTaken(it){if(fbu.taken)return fbu.taken;const more=fbu.items.some((x)=>x!==it&&x.state==='wait');
  const how=(v,k)=>({value:v,label:topText(k)});
  const pick=await askPick(topFill('fb.upTaken',{name:it.rel}),[how('skip','fb.upSkip'),how('keep','fb.upKeep'),how('replace','fb.upReplace'),
    ...(more?[how('skip:all','fb.upSkipAll'),how('keep:all','fb.upKeepAll'),how('replace:all','fb.upReplaceAll')]:[])]);
  const [what,all]=(pick||'skip').split(':');if(all)fbu.taken=what;return what;}
async function fbUpOne(it){
  const start={url:'/admin/api/files/upload/chunks',body:{root:it.root,path:it.path,rel:it.rel,size:it.file.size,lastModified:it.file.lastModified,taken:it.taken}};
  const r=await chunkUpload(null,it.file,(n)=>{it.sent=n;fbUpPaint(it);fbUpShow();},start,it.ctl.signal);
  if(it.state==='stop')return;
  if(r.status===409&&r.d.code==='exists'&&!it.taken){const what=await fbUpTaken(it);
    if(what!=='skip'&&it.state!=='stop'){it.taken=what;return fbUpOne(it);}
    if(it.state!=='stop'){it.state='skip';fbu.skipped++;}return;}
  if(r.status===409&&r.d.code==='exists'){it.state='skip';fbu.skipped++;return;}
  if(r.status!==200){it.state='fail';it.msg=r.d?.error||topText('u.rNet');return;}
  const f=await chunkCall('POST','/admin/api/files/upload',JSON.stringify({root:it.root,path:it.path,items:[{id:r.id,rel:it.rel,taken:it.taken}]}),'application/json');
  if(f.status!==200){it.state='fail';it.msg=f.d.error||String(f.status);return;}
  fbu.placed+=f.d.placed.length;fbu.skipped+=f.d.skipped.length;it.state=f.d.placed.length?'done':'skip';it.to=f.d.placed[0];it.restore=f.d.restore;}
// A batch is one step: the undo sends what it put up to the trash and brings back what it replaced. The drop box is
// left out, because what lands there is sorted away at once.
function fbUpSteps(){const fresh=fbu.items.filter((x)=>x.state==='done'&&x.to&&!x.stepped&&x.root!=='incoming');let pushed=false;
  for(const root of new Set(fresh.map((x)=>x.root))){const mine=fresh.filter((x)=>x.root===root);const restore=mine.flatMap((x)=>x.restore||[]);
    pushed=fbUndoPush({trash:{root,paths:mine.map((x)=>x.to)},held:mine.length,redoUp:true,...(restore.length?{restore}:{})})||pushed;}
  for(const x of fresh)x.stepped=true;return pushed;}
async function fbUpRun(){fbu.busy=true;fbUpShow();let it;
  while((it=fbu.items.find((x)=>x.state==='wait'))){it.state='up';fbUpPaint(it);
    await fbUpOne(it);fbUpPaint(it);fbUpShow();
    if(it.root===fb.root&&!fbu.items.some((x)=>x.state==='wait'))fbLoad();}
  const said=fbu.skipped?topFill('fb.upSome',{n:num(fbu.placed),s:num(fbu.skipped)}):topFill('fb.uploaded',{n:num(fbu.placed)});
  if(fbUpSteps())fbToastUndo(said);else if(fbu.placed||fbu.skipped)toast(said);
  const whole=fbu.placed?fbu.items.filter((x)=>x.root==='incoming'&&x.state==='done'&&x.to).map((x)=>x.to):[];
  Object.assign(fbu,{busy:false,placed:0,skipped:0,taken:null});fbUpShow();
  if(whole.length)fbSortBox(whole.slice(-500));}
// What went up into the drop box is whole already, so it is sorted now instead of at the next timed sweep.
async function fbSortBox(whole){try{const d=await api('/admin/api/library/organize/sweep',{method:'POST',body:{whole}});
  if(d.moved)toast(topText('lo.moved').split('{n}').join(num(d.moved)));if(fb.root==='incoming')fbLoad();}catch(err){toast(err.message);}}
$('fb-up-stop').addEventListener('click',()=>{for(const it of fbu.items)fbUpStop(it);});
$('fb-up-close').addEventListener('click',()=>{fbu.items=[];$('fb-u-list').replaceChildren();fbUpShow();});
$('fb-up-fold').addEventListener('click',(e)=>{const b=e.currentTarget;const open=b.getAttribute('aria-expanded')!=='true';
  b.setAttribute('aria-expanded',String(open));$('fb-u-list').hidden=!open;});
// A page left while files go up asks first; what was sent waits a day and the same file picks up where it stopped.
window.addEventListener('beforeunload',(e)=>{if(fbu.busy){e.preventDefault();e.returnValue='';}});
// Files dropped on a folder (a row, the tree, the path) go up into it, anywhere else into the open folder; a folder keeps its shape.
{let depth=0,lit=null;const wrap=document;const has=(e)=>$('fb').offsetParent!==null&&[...(e.dataTransfer?.types||[])].includes('Files');
  const spot=(e)=>{const n=e.target.closest?.('.fb-takes');const d=n?n.fbDest():false;return d===false||d==null?null:{n,d};};
  const light=(s,e)=>{if(lit&&lit!==s?.n)lit.classList.remove('fb-target');lit=s?.n||null;if(s){lit.classList.add('fb-target');fbTip(e,s.d,'fb.dropUp');}else fbTip(null);};
  wrap.addEventListener('dragenter',(e)=>{if(!has(e))return;e.preventDefault();depth++;$('fb').classList.add('dragging');});
  wrap.addEventListener('dragover',(e)=>{if(!has(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';light(spot(e),e);});
  wrap.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;$('fb').classList.remove('dragging');light(null);}});
  wrap.addEventListener('drop',async(e)=>{if(!has(e))return;e.preventDefault();const s=spot(e);depth=0;$('fb').classList.remove('dragging');light(null);fbUpload(await fbDropped(e.dataTransfer),s?s.d:fb.path);});}
// One upload button on the screen: where the explorer shows, the header's button uploads into the folder that is open.
$('up-entry')?.addEventListener('click',(e)=>{if($('fb').offsetParent===null)return;e.preventDefault();$('fb-file').click();});
// A picked folder names each file under it (webkitRelativePath), so the folder lands with its shape like a dropped one.
for(const id of ['fb-file','fb-dir'])$(id).addEventListener('change',(e)=>{const files=[...e.target.files];e.target.value='';
  fbUpload(files.map((f)=>({file:f,rel:f.webkitRelativePath||f.name})));});
// The move dialog walks folders only, starting where the list is; "Move here" takes the selection there.
const fbm={root:'',path:'',seq:0};
async function fbMoveLoad(){const n=++fbm.seq;const list=$('fb-m-list');fbMoveOk();
  fbRootButtons($('fb-m-roots'),fbm.root,(k)=>{fbm.root=k;fbm.path='';fbMoveLoad();});
  const c=$('fb-m-crumb');c.replaceChildren();const parts=fbm.path?fbm.path.split('/'):[];
  const add=(label,to)=>{if(c.childNodes.length)c.append(el('span','/'));const b=el('button',label);b.type='button';b.addEventListener('click',()=>{fbm.path=to;fbMoveLoad();});c.append(b);};
  add(fbRootName(fbm.root),'');parts.forEach((p,i)=>add(p,parts.slice(0,i+1).join('/')));
  let d;try{d=await api('/admin/api/files/list?'+new URLSearchParams({root:fbm.root,path:fbm.path,perPage:'500'}));}catch(err){if(n===fbm.seq)list.replaceChildren(el('p',err.message));return;}
  if(n!==fbm.seq)return;const dirs=d.items.filter((f)=>f.type==='dir'&&!(fbm.root===fb.root&&fb.sel.has(f.rel)));
  const go=(label,to,ic)=>{const b=el('button');b.type='button';b.innerHTML=ic;b.append(el('span',label));b.addEventListener('click',()=>{fbm.path=to;fbMoveLoad();});return b;};
  const up=fbm.path?[go(topText('fb.up'),fbm.path.split('/').slice(0,-1).join('/'),FB_ICON.up)]:[];
  list.replaceChildren(...up,...dirs.map((f)=>go(f.name,f.rel,FB_ICON.dir)));
  if(!dirs.length)list.append(el('p',topText('fb.empty')));}
async function fbMoveNewFolder(){const name=await askText(topText('fb.newFolderAsk'),'');if(name==null||!name.trim())return;
  try{const out=await api('/admin/api/files/mkdir',{method:'POST',body:{root:fbm.root,path:fbm.path,name:name.trim()}});
    fbUndoPush({trash:{root:out.root,paths:[out.rel]},held:0});fbm.path=out.rel;fbMoveLoad();}catch(err){toast(err.message);}}
// 정리: the folder's own layout on the pick (or the open folder), shown first and carried out on a click
// (library/tidy.js for games, library/tidy-places.js for the rest). The whole run comes back with one undo.
async function fbTidy(){if(fb.root==='incoming')return;const root=fb.root;const rels=fb.sel.size?[...fb.sel]:[fb.path];const dlg=$('fb-tidy');const list=$('fb-t-list');const ok=$('fb-t-ok');
  $('fb-t-sum').textContent=topText('fb.tidyBusy');list.replaceChildren();ok.disabled=true;ok.textContent=topText('fb.tidy');ok.onclick=null;dlg.showModal();
  let p;try{p=await api('/admin/api/files/tidy/plan',{method:'POST',body:{root,paths:rels}});}catch(err){$('fb-t-sum').textContent=err.message;return;}
  if(!dlg.open)return;$('fb-t-sum').textContent=topText(p.moves.length?(root==='games'?'fb.tidyHint':'fb.tidyHint.'+root):'fb.tidyNone');
  const rows=p.moves.map((m)=>{const li=el('li',null,'fb-t-move');li.append(el('span',m.from,'fb-t-from'),el('span',m.to,'fb-t-to'));
    if(m.art?.length)li.append(el('span',topFill('fb.tidyArt',{n:num(m.art.length)}),'fb-t-art'));return li;});
  if(p.held.length){rows.push(el('li',topFill('fb.tidyHeld',{n:num(p.held.length)}),'fb-t-head'));
    for(const h of p.held){const li=el('li',null,'fb-t-held');li.append(el('span',h.rel,'fb-t-to'),el('span',h.reason,'fb-t-from'));rows.push(li);}}
  list.replaceChildren(...rows);ok.textContent=topFill('fb.tidyRun',{n:num(p.moves.length)});ok.disabled=!p.moves.length;
  ok.onclick=async()=>{ok.disabled=true;
    try{const out=await api('/admin/api/files/tidy/apply',{method:'POST',body:{root,paths:rels,moves:p.moves}});dlg.close();fb.sel.clear();
      fbUndoPush({journal:out.moved.map((m)=>m.undo)});const msg=topFill('fb.tidyDone',{n:num(out.moved.filter((m)=>!m.art).length)});
      if(out.moved.length)fbToastUndo(msg);else toast(msg);fbLoad();}
    catch(err){toast(err.message);ok.disabled=false;}};}
$('fb-t-no').addEventListener('click',()=>$('fb-tidy').close());
// The button names the folder it moves into, and does nothing where the pick already is.
function fbMoveOk(){const ok=$('fb-m-ok');ok.textContent=topFill('fb.dragTo',{name:fbm.path.split('/').pop()||fbRootName(fbm.root)});ok.disabled=fbm.root===fb.root&&fbm.path===fb.path;}
function fbMove(){const rels=[...fb.sel];if(!rels.length)return;fbm.root=fb.root;fbm.path=fb.path;const dlg=$('fb-move');
  const done=()=>{$('fb-m-ok').onclick=$('fb-m-no').onclick=null;dlg.close();};
  $('fb-m-no').onclick=done;
  $('fb-m-new').onclick=fbMoveNewFolder;
  $('fb-m-ok').onclick=()=>{const to={root:fbm.root,path:fbm.path};done();fbMoveTo(rels,to.root,to.path);};
  dlg.showModal();fbMoveLoad();}
// A move or copy the server refused as a likely mistake says why, in the page's words (file-roots.js PLACE_RULES).
const FB_WHY={'game-into-game':'fb.gameIntoGame','title-into-title':'fb.titleIntoTitle','game-wrong-root':'fb.gameWrongRoot'};
// What the server noticed about where something landed (library/place-review.js): allowed, but it may not read as it should.
const FB_NOTE={'other-game':'fb.r.otherGame','retro-no-system':'fb.r.noSystem','retro-wrong-system':'fb.r.wrongSystem','retro-too-deep':'fb.r.tooDeep'};
const fbNotes=(notes)=>[...new Set((notes||[]).map((x)=>FB_NOTE[x.code]).filter(Boolean))].map(topText).join(' ');
function fbRefusal(skipped){const s=skipped.find((x)=>FB_WHY[x.code]);return s?topText(FB_WHY[s.code]):'';}
async function fbMoveTo(rels,toRoot,toPath,fromRoot=fb.root){if(fbStillBusy()||!await fbServerOk(rels,fromRoot))return;
  try{const out=await fbBusyRun(topFill('fb.moving',{n:num(rels.length)}),()=>fbStep(fbPost('move',{root:fromRoot,paths:rels,toRoot,toPath}),(o)=>({journal:o.moved.map((m)=>m.undo)})));
    for(const m of out.moved)fb.sel.delete(m.from);
    const why=fbRefusal(out.skipped);if(!out.moved.length&&why){toast(why);fbLoad();return;}
    const msg=(out.skipped.length?topFill('fb.movedSome',{moved:num(out.moved.length),skipped:num(out.skipped.length)}):topFill('fb.moved',{n:num(out.moved.length)}))+(why?' '+why:'');
    const note=fbNotes(out.notes);
    if(out.moved.length)fbToastUndo(note?msg+'. '+note:msg,note?FB_NOTE_TOAST_MS:FB_UNDO_TOAST_MS);else toast(msg);fbLoad();}
  catch(err){toast(err.message);}}
// Rows dragged onto a folder row or a step of the path move there, the whole pick when the dragged row is in it.
// Only the list's own drags count: files dragged in from the desktop are uploads (the list's drop handlers).
const FB_DRAG='application/x-cookingfoil-files';
function fbDragStart(e,rel){if(!fb.sel.has(rel))fbPick(rel);fb.drag=[...fb.sel];
  e.dataTransfer.setData(FB_DRAG,JSON.stringify({root:fb.root,paths:fb.drag}));e.dataTransfer.effectAllowed='copyMove';
  // One file dragged out of the window onto the desktop downloads there (Chromium's DownloadURL).
  const f=fb.drag.length===1&&fbItem(fb.drag[0]);
  if(f&&f.type==='file')e.dataTransfer.setData('DownloadURL','application/octet-stream:'+f.name+':'+location.origin+'/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel}));}
// A move by mouse is easy to make by mistake, so the drag says where it will land, beside the pointer. The notice
// after any change that can be taken back (a move, a copy, a rename, a delete) carries the undo for a few seconds.
function fbTip(e,dest,word='fb.dragTo'){const tip=$('fb-dragtip');if(!e){tip.hidden=true;return;}
  const name=dest?dest.split('/').pop():(document.querySelector('#fb-crumb li:first-child')?.textContent||'');
  tip.textContent=topFill(word,{name});tip.hidden=false;tip.style.left=(e.clientX+16)+'px';tip.style.top=(e.clientY+18)+'px';}
function fbToastUndo(msg,ms=FB_UNDO_TOAST_MS){toastUndo(msg,fbUndo,ms);}
const FB_UNDO_TOAST_MS=7000;
const FB_NOTE_TOAST_MS=15000;
function fbDropTarget(node,dest){node.classList.add('fb-takes');node.fbDest=dest;const ours=(e)=>fb.drag&&[...e.dataTransfer.types].includes(FB_DRAG)&&dest()!==false;
  // Ctrl, or Option on a Mac, makes a drag a copy.
  const copying=(e)=>e.ctrlKey||e.altKey;
  node.addEventListener('dragover',(e)=>{if(!ours(e))return;e.preventDefault();e.dataTransfer.dropEffect=copying(e)?'copy':'move';node.classList.add('fb-target');fbTip(e,dest(),copying(e)?'fb.dragCopy':'fb.dragTo');});
  node.addEventListener('dragleave',()=>{node.classList.remove('fb-target');fbTip(null);});
  node.addEventListener('drop',(e)=>{node.classList.remove('fb-target');fbTip(null);if(!ours(e))return;e.preventDefault();e.stopPropagation();
    const rels=fb.drag;fb.drag=null;if(copying(e))fbCopyTo(rels,fb.root,{root:fb.root,path:dest()});else fbMoveTo(rels,fb.root,dest());});}
document.addEventListener('dragend',()=>{fb.drag=null;fbTip(null);for(const n of document.querySelectorAll('#fb .fb-target'))n.classList.remove('fb-target');});
// Several items, or a folder, come down as one zip: the server gets the list, the browser's own download takes the file.
async function fbZip(rels){if(!rels.length)return;toast(topText('fb.zipping'));
  try{const out=await api('/admin/api/files/zip',{method:'POST',body:{root:fb.root,paths:rels}});toast(topFill('fb.zipStart',{n:num(out.files),size:fbSize(out.bytes)}));location.href=out.url;}catch(err){toast(err.message);}}
// A look at an image or the start of a text file without leaving the list. The bytes come through the download
// address into a blob, so nothing of the file is ever served as a page of this site; text is shown as text.
const FB_VIEW={image:new Set(['png','jpg','jpeg','gif','webp','bmp','avif','svg','ico']),
  text:new Set(['txt','md','json','jsonc','json5','ini','cfg','conf','log','xml','yml','yaml','csv','nfo','toml','lua','js','css','html','sh','py','bat','srt','cht','lst'])};
const FB_VIEW_MAX={image:32*1048576,text:262144};
const fbKind=(f)=>f.type==='file'&&(FB_VIEW.image.has(f.ext)?'image':FB_VIEW.text.has(f.ext)?'text':null);
const fbv={f:null,url:null,seq:0};
function fbViewList(){return fb.data?fb.data.items.filter((x)=>fbKind(x)&&(fbKind(x)!=='image'||x.size<=FB_VIEW_MAX.image)):[];}
async function fbView(f){const dlg=$('fb-view');const n=++fbv.seq;fbv.f=f;const kind=fbKind(f);
  $('fb-v-title').textContent=f.name;$('fb-v-title').title=f.name;const body=$('fb-v-body');body.classList.remove('fb-v-full');const note=$('fb-v-note');note.hidden=true;
  const list=fbViewList(),i=list.findIndex((x)=>x.rel===f.rel);$('fb-v-prev').disabled=i<=0;$('fb-v-next').disabled=i<0||i>=list.length-1;
  if(!dlg.open)dlg.showModal();body.replaceChildren(el('p',topText('fb.viewLoading'),'muted'));
  if(kind==='image'&&f.size>FB_VIEW_MAX.image){body.replaceChildren(el('p',topText('fb.viewBig'),'muted'));return;}
  const qs=new URLSearchParams({root:fb.root,path:f.rel});const headers=kind==='text'?{Range:'bytes=0-'+(FB_VIEW_MAX.text-1)}:{};
  let blob;try{const r=await fetch('/admin/api/files/download?'+qs,{headers});
    if(!r.ok){let msg=String(r.status);try{msg=(await r.json()).error||msg;}catch{}throw new Error(msg);}blob=await r.blob();}
  catch(err){if(n===fbv.seq)body.replaceChildren(el('p',topFill('fb.viewFail',{msg:err.message}),'muted'));return;}
  if(n!==fbv.seq)return;fbViewFree();
  if(kind==='image'){fbv.url=URL.createObjectURL(blob);const img=el('img');img.alt=f.name;
    // A picture shrunk to fit opens at its own size with a tap: a panorama fitted to a phone is a sliver.
    img.addEventListener('click',()=>body.classList.toggle('fb-v-full'));
    img.addEventListener('load',()=>{if(img.naturalWidth>img.clientWidth+1||img.naturalHeight>img.clientHeight+1){note.hidden=false;note.textContent=topText('fb.viewZoom');}},{once:true});
    img.src=fbv.url;body.replaceChildren(img);return;}
  body.replaceChildren(el('pre',new TextDecoder().decode(await blob.arrayBuffer())));
  if(f.size>FB_VIEW_MAX.text){note.hidden=false;note.textContent=topFill('fb.viewCut',{size:fbSize(FB_VIEW_MAX.text)});}}
function fbViewFree(){if(fbv.url)URL.revokeObjectURL(fbv.url);fbv.url=null;}
function fbViewStep(d){const list=fbViewList();const i=list.findIndex((x)=>x.rel===fbv.f?.rel);const to=list[i+d];if(to){fbPick(to.rel);fbView(to);}}
$('fb-v-prev').addEventListener('click',()=>fbViewStep(-1));$('fb-v-next').addEventListener('click',()=>fbViewStep(1));
$('fb-v-dl').addEventListener('click',()=>{if(fbv.f)fbDownload(fbv.f);});$('fb-v-x').addEventListener('click',()=>$('fb-view').close());
// A swipe across a preview steps as the arrows do; a text preview scrolls sideways on its own.
{const FB_SWIPE=60;let from=null;const v=$('fb-view');
  v.addEventListener('touchstart',(e)=>{from=e.touches.length===1&&!e.target.closest('pre,.fb-v-full')&&(visualViewport?.scale??1)<=1.01?e.touches[0]:null;},{passive:true});
  v.addEventListener('touchend',(e)=>{if(!from)return;const t=e.changedTouches[0],dx=t.clientX-from.clientX,dy=t.clientY-from.clientY;from=null;
    if(Math.abs(dx)>=FB_SWIPE&&Math.abs(dx)>Math.abs(dy)*2)fbViewStep(dx<0?1:-1);});}
$('fb-view').addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft'){e.preventDefault();fbViewStep(-1);}else if(e.key==='ArrowRight'){e.preventDefault();fbViewStep(1);}});
$('fb-view').addEventListener('close',()=>{fbv.seq++;fbViewFree();$('fb-v-body').replaceChildren();fbFocusRow();});
function fbAll(on){for(const rel of fbRels()){if(on)fb.sel.add(rel);else fb.sel.delete(rel);}fbPaint();}
$('fb-all').addEventListener('change',(e)=>fbAll(e.target.checked));
for(const b of document.querySelectorAll('#fb thead [data-sort]'))b.addEventListener('click',()=>{const s=b.dataset.sort;
  if(fb.sort===s)fb.order=fb.order==='asc'?'desc':'asc';else{fb.sort=s;fb.order=s==='name'?'asc':'desc';}fbLoad();});
$('fb-q').addEventListener('input',()=>{clearTimeout(fb.timer);fb.timer=setTimeout(()=>{const q=$('fb-q').value.trim();if(q===fb.q)return;fb.q=q;if(!q)fbDeepReset();fbLoad();},250);});
$('fb-mkdir').addEventListener('click',fbMkdir);
$('fb-move-btn').addEventListener('click',fbMove);
$('fb-zip-btn').addEventListener('click',()=>{const rels=[...fb.sel];const one=rels.length===1?fbItem(rels[0]):null;if(one?.type==='file')fbDownload(one);else fbZip(rels);});
$('fb-cut-btn').addEventListener('click',()=>fbClip('cut'));$('fb-copy-btn').addEventListener('click',()=>fbClip('copy'));$('fb-paste-btn').addEventListener('click',fbPaste);
$('fb-rename-btn').addEventListener('click',()=>{const one=fb.sel.size===1?fbItem([...fb.sel][0]):null;if(one)fbRename(one);});
$('fb-share-btn').addEventListener('click',()=>{const one=fb.sel.size===1?fbItem([...fb.sel][0]):null;if(one)fbShare(one);});
$('fb-undo-btn').addEventListener('click',fbUndo);$('fb-tidy-btn').addEventListener('click',fbTidy);$('fb-refresh').addEventListener('click',()=>fbLoad());
$('fb-trash-btn').addEventListener('click',()=>fbTrash([...fb.sel]));
$('fb-clear').addEventListener('click',()=>{fb.sel.clear();fb.anchor=null;fbPaint();});
$('fb-pick-all').addEventListener('click',()=>fbAll(!$('fb-all').checked));
window.addEventListener('popstate',(e)=>{const p=new URLSearchParams(location.search);fb.hi=e.state?.fbi??0;
  if(fb.root&&p.get('tab')==='folder')fbGo(fb.root,p.get('path')||'',{push:false});});
// On a focused row: the arrows, Home and End walk the list (Shift stretches the pick, Ctrl or Cmd only moves),
// Space picks (Ctrl+Space toggles), Enter opens, F2 renames, and the menu key or Shift+F10 opens the menu.
$('fb-rows').addEventListener('keydown',(e)=>{const tr=e.target;if(tr.tagName!=='TR')return;
  const rels=fbRels(),i=rels.indexOf(tr.dataset.rel),f=fbItem(tr.dataset.rel);
  const walk=(j)=>{const rel=rels[Math.max(0,Math.min(rels.length-1,j))];if(rel==null)return;
    if(e.shiftKey)fbPick(rel,{range:true,add:e.ctrlKey||e.metaKey});else if(e.ctrlKey||e.metaKey){fb.focus=rel;fbPaint();}else fbPick(rel);fbFocusRow();};
  const step=fbCols();
  if(e.key==='ArrowDown')walk(i+step);else if(e.key==='ArrowUp'&&!e.altKey)walk(i-step);
  else if(step>1&&e.key==='ArrowRight')walk(i+1);else if(step>1&&e.key==='ArrowLeft')walk(i-1);else if(e.key==='Home')walk(0);else if(e.key==='End')walk(rels.length-1);
  else if(e.key===' '&&!fb.typing){if(e.ctrlKey||e.metaKey||!fb.sel.has(tr.dataset.rel))fbPick(tr.dataset.rel,{add:true});}else if(e.key==='Enter'&&f)fbActivate(f);else if(e.key==='F2'&&f)fbRename(f);
  else if(e.key==='ContextMenu'||(e.key==='F10'&&e.shiftKey)){if(!fb.sel.has(tr.dataset.rel))fbPick(tr.dataset.rel);const r=tr.getBoundingClientRect();fbMenu(r.left+48,r.bottom-8);}
  else return;
  e.preventDefault();});
// Anywhere on the open file tab: Esc clears the pick, Delete trashes it, Ctrl or Cmd+A picks the page, Backspace or
// Alt+Up goes to the parent folder. None fires while typing or in a dialog.
document.addEventListener('keydown',(e)=>{if(!$('fb')?.offsetParent||e.target.closest(FB_NOT_KEYS))return;
  if(e.key==='Escape'&&fb.sel.size)$('fb-clear').click();else if(e.key==='Escape'&&fb.clip)fbClipDrop();else if(e.key==='Delete'&&fb.sel.size)fbTrash([...fb.sel]);
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&fbRels().length){e.preventDefault();fbAll(true);}
  else if(e.key==='Backspace'||(e.altKey&&e.key==='ArrowUp')){if(fb.path){e.preventDefault();fbParent();}}
  else if(e.altKey&&e.key==='ArrowLeft'&&fb.hi>0){e.preventDefault();history.back();}
  else if(e.altKey&&e.key==='ArrowRight'&&fb.hi<fb.hmax){e.preventDefault();history.forward();}});
// The menu for a right click: on rows it holds what the pick allows, on the empty part of the list a new folder
// and an upload. It closes on a pick, Esc, a click elsewhere, a scroll or a resize, and gives focus back.
// It lives on the body: a page panel that is a containing block (a transform, a filter) would offset a fixed menu by its own place.
document.body.append($('fb-menu'));
function fbActions(){const rels=[...fb.sel];const one=rels.length===1?fbItem(rels[0]):null;
  const items=[];const add=(key,ic,fn,danger)=>items.push({key,ic,fn,danger});
  if(rels.length){
    if(one?.type==='dir')add('fb.open','open',()=>fbActivate(one));
    if(one&&fbKind(one))add('fb.view','view',()=>fbView(one));
    if(one?.type==='file')add('fb.download','download',()=>fbDownload(one));
    else add('fb.zip','zip',()=>fbZip(rels));
    if(one)add('fb.share','share',()=>fbShare(one));
    if(one?.shared)add('fb.shareEndAll','stop',()=>fbShareEndAll(one));
    if(fb.root==='games'){const picked=rels.map(fbItem).filter(Boolean);const has=(re)=>picked.some((f)=>f.type==='dir'||re.test(f.name));
      if(has(/[.](nsp|xci)$/i))add('fb.nsz','nsz',()=>fbNsz(rels));if(has(/[.](nsp|nsz|xci|xcz)$/i))add('fb.verify','verify',()=>fbVerify(rels));}
    add('fb.cut','cut',()=>fbClip('cut'));add('fb.copy','copy',()=>fbClip('copy'));
    if(one)add('fb.rename','rename',()=>fbRename(one));
    if(fb.clip){add('fb.paste','paste',fbPaste);add('fb.clipDrop','stop',fbClipDrop);}
    add('fb.move','move',fbMove);add('fb.trash','trash',()=>fbTrash(rels),true);
    if(fb.undos.length)add('fb.undo','undo',fbUndo);if(fb.redos.length)add('fb.redo','refresh',fbRedo);add('fb.props','props',fbProps);
}
  else{add('fb.newFolder','mkdir',fbMkdir);add('fb.upload','upload',()=>$('fb-file').click());add('fb.uploadDir','open',()=>$('fb-dir').click());
    if(fbPhone()&&fb.root!=='incoming')add('fb.tidy','tidy',fbTidy);
    if(fbPhone()&&fb.root==='games'&&$('rescan'))items.push({label:$('rescan').textContent.trim(),ic:'refresh',fn:()=>$('rescan').click()});
    if(fb.clip){add('fb.paste','paste',fbPaste);add('fb.clipDrop','stop',fbClipDrop);}if(fb.undos.length)add('fb.undo','undo',fbUndo);if(fb.redos.length)add('fb.redo','refresh',fbRedo);add('fb.props','props',fbProps);}
  return items;}
// A phone's bottom bar: the likeliest three of what the pick allows, the trash, and the whole list behind 파일 메뉴.
const FB_BAR=['fb.view','fb.download','fb.zip','fb.rename','fb.move'];
// With nothing picked it offers the one thing a phone does next there, and the same 파일 메뉴 holds the rest.
const FB_IDLE=['fb.paste','fb.upload'];
function fbPickBar(){const bar=$('fb-pick-acts');if(!fbPhone()){bar.replaceChildren();return;}
  const all=fbActions();const top=fb.sel.size?[...FB_BAR.map((k)=>all.find((a)=>a.key===k)).filter(Boolean).slice(0,3),all.find((a)=>a.key==='fb.trash')]:FB_IDLE.map((k)=>all.find((a)=>a.key===k)).filter(Boolean).slice(0,1).map((a)=>a.key==='fb.paste'?{...a,label:topText(a.key)+' '+num(fb.clip.rels.length)}:a);
  bar.replaceChildren(...[...top,{key:'fb.menu',ic:'more',fn:()=>fbMenu(0,0)}].map((it)=>{
    const b=el('button');b.type='button';b.innerHTML=FB_ICON[it.ic]||'';b.append(el('span',it.label||topText(it.key)));if(it.danger)b.dataset.danger='';b.addEventListener('click',it.fn);return b;}));}
matchMedia('(max-width:760px)').addEventListener('change',()=>{fbPickBar();for(const r of document.querySelectorAll('#fb-rows tr'))r.draggable=!fbPhone();});
function fbMenu(x,y){const m=$('fb-menu');const rels=[...fb.sel];const items=fbActions();
  const back=document.activeElement;
  m.replaceChildren(...items.map((it,i)=>{const b=el('button');b.type='button';b.setAttribute('role','menuitem');b.tabIndex=i?-1:0;
    b.innerHTML=FB_ICON[it.ic]||'';b.append(el('span',it.label||topText(it.key)));if(it.danger)b.dataset.danger='';
    b.addEventListener('click',()=>{fbMenuClose(false);it.fn();});return b;}));
  if(rels.length>1)m.prepend(el('p',topFill('fb.selected',{n:num(rels.length)}),'muted fb-m-head'));
  // clientWidth and clientHeight leave out the scrollbars, which innerWidth and innerHeight would let the menu sit under.
  m.hidden=false;m._at=performance.now();const r=m.getBoundingClientRect();const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
  m.style.left=Math.max(8,Math.min(x,vw-r.width-8))+'px';m.style.top=Math.max(8,Math.min(y,vh-r.height-8))+'px';
  m.querySelector('button')?.focus({preventScroll:true});m._back=back;}
function fbMenuClose(refocus=true){const m=$('fb-menu');if(m.hidden)return;m.hidden=true;if(refocus&&m._back?.isConnected)m._back.focus({preventScroll:true});m._back=null;}
$('fb-menu').addEventListener('keydown',(e)=>{const bs=[...$('fb-menu').querySelectorAll('button')];const i=bs.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();bs[(i+(e.key==='ArrowDown'?1:-1)+bs.length)%bs.length]?.focus({preventScroll:true});}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();bs[e.key==='Home'?0:bs.length-1]?.focus({preventScroll:true});}
  else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();fbMenuClose();}});
document.addEventListener('pointerdown',(e)=>{if(!e.target.closest('#fb-menu'))fbMenuClose(false);},true);
// A scroll closes the menu, but not the one the opening itself sets off (the bar changing height as the pick clears).
const FB_MENU_SETTLE_MS=250;
addEventListener('scroll',(e)=>{if(e.target.closest?.('#fb-menu')||performance.now()-($('fb-menu')._at||0)<FB_MENU_SETTLE_MS)return;fbMenuClose(false);},true);addEventListener('resize',()=>fbMenuClose(false));
$('fb-main').addEventListener('contextmenu',(e)=>{if(e.target.closest('#fb-rows tr,#fb-menu'))return;
  e.preventDefault();fb.sel.clear();fb.anchor=null;fbPaint();fbMenu(e.clientX,e.clientY);});
// The page's own folder is the only root here; the roots list is for the move dialog's picker.
async function fbOpen(root){
  if(!fb.root&&!fb.booting){fb.booting=true;fbSkel();
    try{fb.roots=(await api('/admin/api/files/roots')).roots;}catch(err){fb.booting=false;$('fb-rows').replaceChildren();toast(err.message);return;}
    const p=new URLSearchParams(location.search);fb.booting=false;fb.hi=fb.hmax=history.state?.fbi??0;
    fbGo(root,p.get('tab')==='folder'?p.get('path')||'':'',{push:false});}
  if(fb.root)history.replaceState({fbi:fb.hi},'',fbUrl());}
// A page's tab row with the "파일" tab: opening it starts the browser, leaving it clears the folder from the address.
function fbTabs(tab,root){subtabs(tab);const st=SUBTABS[tab];if(!st)return;const show=st.show;
  st.show=(sub)=>{show(sub);if(sub==='folder')fbOpen(root);};
  st.show(location.hash.split('/')[1]||st.cur);}
// A language switch redraws the path, the dates and the counts.
function fbRelabel(){if(typeof fb==='undefined')return;if(!fb.root)return;fbLoad();}
${EXPLORE_SCRIPT}
${LIBRARY_SCRIPT}
`;
