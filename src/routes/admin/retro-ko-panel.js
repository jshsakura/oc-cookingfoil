/**
 * The retro tab's Korean title block: names the bundled dictionary gives by a
 * ROM's content hash (shown already), and the ones it only guesses from the
 * English title, each with approve and reject. Talks to /admin/api/retro-ko.
 */
import { top } from "./top-i18n.js";

export const RETRO_KO_HTML = `
  <div class="hd"><h2 class="first">${top("rk.tab")}</h2><button type="button" id="rk-index">${top("rk.index")}</button></div>
  <p class="muted">${top("rk.lead")}</p>
  <p class="muted" id="rk-state"></p>
  <h3 id="rk-guess-h"></h3>
  <p class="muted">${top("rk.guessLead")}</p>
  <div class="scroll" id="rk-guesses" data-skel></div>
  <h3 id="rk-confirmed-h"></h3>
  <div class="scroll" id="rk-confirmed" data-skel></div>`;

export const RETRO_KO_SCRIPT = /* js */ `
function rkMore(total,shown){return total>shown?' · '+topFill('rk.more',{n:shown}):'';}
function rkFile(k){const c=td();c.append(k.name);c.append(el('div',k.file,'muted'));return c;}
async function loadRetroKo(){let d;
  try{d=await api('/admin/api/retro-ko');}catch(err){toast(err.message);return;}
  const i=d.index;$('rk-state').textContent=topFill('rk.state',i)+(i.busy?' '+topText('rk.busy'):'');
  $('rk-guess-h').textContent=topFill('rk.guessH',{n:d.guessesTotal})+rkMore(d.guessesTotal,d.guesses.length);
  $('rk-confirmed-h').textContent=topFill('rk.confirmedH',{n:d.confirmedTotal})+rkMore(d.confirmedTotal,d.confirmed.length);
  table('rk-guesses',[topText('rk.colFile'),topText('rk.colSystem'),topText('rk.colKo'),''],d.guesses.map((k)=>{const tr=el('tr');
    const acts=el('div',null,'row-actions');acts.append(btn(topText('rk.approve'),()=>rkDecide(k,true)),btn(topText('rk.reject'),()=>rkDecide(k,false),'danger'));
    tr.append(rkFile(k),td(k.systemName),td(k.ko),raCell(acts));return tr;}),topText('rk.noGuess'));
  table('rk-confirmed',[topText('rk.colFile'),topText('rk.colSystem'),topText('rk.colKo'),topText('rk.colBy')],d.confirmed.map((k)=>{const tr=el('tr');
    tr.append(rkFile(k),td(k.systemName),td(k.ko),td(topText('rk.by.'+k.by)??k.by));return tr;}),topText('rk.noConfirmed'));
}
async function rkDecide(k,approve){
  try{await api('/admin/api/retro-ko/guess',{method:'POST',body:{game:k.id,approve}});toast(topText(approve?'rk.approved':'rk.rejected'));loadRetroKo();}catch(err){toast(err.message);}
}
$('rk-index').addEventListener('click',async()=>{try{await api('/admin/api/retro-ko/index',{method:'POST'});toast(topText('rk.started'));loadRetroKo();}catch(err){toast(err.message);}});
`;
