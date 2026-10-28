/**
 * The chat as a floating widget: a round button at the lower right opens a panel (full screen on a
 * phone) holding the same chat as /admin/chat. The admin build sits on every admin page but the
 * chat's own; the web build sits on the web page for anyone signed in there (routes/chat.js). The
 * button shows itself only once the chat is on and its model is set, and on the web page only for
 * someone signed in (the status call answers 401 otherwise).
 */
import { icon } from "../../views/icons.js";
import { topLabel } from "./top-i18n.js";
import { CHAT_CSS, chatInnerHtml, chatScript } from "./chat-page.js";
import { CHAT_WORDS } from "./chat-words.js";

const webLabel = (k) => `data-i18n-label="${k}" aria-label="${CHAT_WORDS.ko[k]}"`;

function widgetHtml({ web = false } = {}) {
  const label = web ? webLabel : topLabel;
  return /* html */ `<button type="button" class="primary ch-launch" id="ch-launch" hidden aria-expanded="false" ${label("m.chat")}>${icon("chat")}</button>
<div class="ch-widget" id="ch-widget" hidden role="region" ${label("m.chat")}>
${chatInnerHtml({ web })}
</div>`;
}

export const CHAT_WIDGET_CSS = /* css */ `${CHAT_CSS}
.ch-launch{position:fixed;right:20px;bottom:20px;z-index:60;display:grid;place-items:center;width:44px;height:44px;padding:0;border-radius:50%;border:0}
.ch-launch .ico{width:20px;height:20px}
.ch-launch[hidden]{display:none}
/* While the button floats, the page ends below it, so the last row can be scrolled clear of it. */
body:has(.ch-launch:not([hidden])) .wrap{padding-bottom:92px}
.ch-widget{position:fixed;right:20px;bottom:76px;z-index:60;display:flex;flex-direction:column;box-sizing:border-box;width:min(400px,calc(100vw - 32px));height:min(640px,calc(100dvh - 110px));padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-2xl);box-shadow:0 12px 40px rgba(0,0,0,.25)}
.ch-widget[hidden]{display:none}
.ch-widget .ch-col{max-width:none}
@media (max-width:640px){
.ch-launch{right:16px;bottom:16px;width:48px;height:48px}
.ch-launch .ico{width:22px;height:22px}
.ch-widget{inset:0;width:auto;height:auto;border:0;border-radius:0;box-shadow:none}
.ch-widget:not([hidden])~.ch-launch,.ch-launch[aria-expanded="true"]{display:none}
/* The chat covers the phone: the page under it stays put instead of scrolling along. */
body:has(.ch-widget:not([hidden])){overflow:hidden}
}
/* iOS zooms into a field whose text is under 16px when it takes the focus. */
@media (pointer:coarse){.ch-card textarea{font-size:var(--fs-lg)}}
`;

function widgetScript({ web = false } = {}) {
  const body = /* js */ `${chatScript({ web })}
function chWidgetShow(on){$('ch-widget').hidden=!on;$('ch-launch').setAttribute('aria-expanded',String(on));}
async function chWidgetOpen(){
  if($('ch-widget').hidden){chWidgetShow(true);
    // Opened again: read the conversation anew, so an admin's answer to a request shows.
    if(chWidgetOpen.loaded&&chConv&&!chBusy){try{await chPickList(chConv);await chOpen(chConv);}catch(err){toast(err.message);}}
    if(!chWidgetOpen.loaded){chWidgetOpen.loaded=true;chIcon();chSendState();try{await chRefresh();}catch(err){toast(err.message);}}
    // On a touch screen the keyboard waits for a tap on the box; opening it at once covers the chat.
    if(!matchMedia('(pointer:coarse)').matches)$('ch-text').focus();}
  else chWidgetShow(false);}
$('ch-close').hidden=false;
$('ch-close').addEventListener('click',()=>chWidgetShow(false));
$('ch-launch').addEventListener('click',chWidgetOpen);
addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!$('ch-widget').hidden&&!($('ch-sheet')&&$('ch-sheet').open))chWidgetShow(false);});
// Shown only while the chat is on and its model is set; a 404 (off), a 401 (signed out) or a sign-out leaves it hidden.
// The body is read even on a 404, so the request ends and the page counts as idle.
fetch(CH_API+'?status=1',{headers:{Accept:'application/json'}}).then((r)=>r.json().catch(()=>null)).then((d)=>{if(d&&d.configured){chState.name=d.name||'';$('ch-launch').hidden=false;}}).catch(()=>{});
`;
  // On the web page the chat's names stay inside one scope, clear of the page's own.
  return web ? `(()=>{${body}})();` : body;
}

export const CHAT_WIDGET_HTML = widgetHtml();
export const CHAT_WIDGET_SCRIPT = widgetScript();

/** The web page's build (landing.html): its words come from the page's own dictionary. */
export const WEB_CHAT_WIDGET_HTML = widgetHtml({ web: true });
export const WEB_CHAT_WIDGET_SCRIPT = widgetScript({ web: true });
/** The chat's words in the web page's four languages, merged into its dictionary. */
export const WEB_CHAT_WORDS = Object.fromEntries(["ko", "en", "ja", "zh"].map((code) => [code, CHAT_WORDS[code]]));
