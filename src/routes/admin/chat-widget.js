/**
 * The chat as a floating widget on every admin page but its own: a round button at the lower
 * right opens a panel (full screen on a phone) holding the same chat as /admin/chat, with the same
 * conversations. The button shows itself only once the chat is on and its model is set.
 */
import { icon } from "../../views/icons.js";
import { topLabel } from "./top-i18n.js";
import { CHAT_CSS, CHAT_INNER_HTML, CHAT_SCRIPT } from "./chat-page.js";

export const CHAT_WIDGET_HTML = /* html */ `<button type="button" class="primary ch-launch" id="ch-launch" hidden aria-expanded="false" ${topLabel("m.chat")}>${icon("sparkle")}</button>
<div class="ch-widget" id="ch-widget" hidden role="region" ${topLabel("m.chat")}>
${CHAT_INNER_HTML}
</div>`;

export const CHAT_WIDGET_CSS = /* css */ `${CHAT_CSS}
.ch-launch{position:fixed;right:20px;bottom:20px;z-index:60;display:grid;place-items:center;width:52px;height:52px;padding:0;border-radius:50%;border:0}
.ch-launch .ico{width:24px;height:24px}
.ch-launch[hidden]{display:none}
/* While the button floats, the page ends below it, so the last row can be scrolled clear of it. */
body:has(.ch-launch:not([hidden])) .wrap{padding-bottom:104px}
.ch-widget{position:fixed;right:20px;bottom:84px;z-index:60;display:flex;flex-direction:column;box-sizing:border-box;width:min(400px,calc(100vw - 32px));height:min(640px,calc(100dvh - 110px));padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-2xl);box-shadow:0 12px 40px rgba(0,0,0,.25)}
.ch-widget[hidden]{display:none}
.ch-widget .ch-col{max-width:none}
@media (max-width:640px){
.ch-launch{right:16px;bottom:16px}
.ch-widget{inset:0;width:auto;height:auto;border:0;border-radius:0;box-shadow:none}
.ch-widget:not([hidden])~.ch-launch,.ch-launch[aria-expanded="true"]{display:none}
}
`;

export const CHAT_WIDGET_SCRIPT = /* js */ `${CHAT_SCRIPT}
function chWidgetShow(on){$('ch-widget').hidden=!on;$('ch-launch').setAttribute('aria-expanded',String(on));}
async function chWidgetOpen(){
  if($('ch-widget').hidden){chWidgetShow(true);if(!chWidgetOpen.loaded){chWidgetOpen.loaded=true;chIcon();chSendState();try{await chRefresh();}catch(err){toast(err.message);}}
    $('ch-text').focus();}
  else chWidgetShow(false);}
$('ch-close').hidden=false;
$('ch-close').addEventListener('click',()=>chWidgetShow(false));
$('ch-launch').addEventListener('click',chWidgetOpen);
addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!$('ch-widget').hidden&&!$('ch-sheet').open)chWidgetShow(false);});
// Shown only while the chat is on and its model is set; a 404 (off) or a sign-out leaves it hidden.
fetch('/admin/api/chat?status=1',{headers:{Accept:'application/json'}}).then((r)=>r.ok?r.json():null).then((d)=>{if(d&&d.configured)$('ch-launch').hidden=false;}).catch(()=>{});
`;
