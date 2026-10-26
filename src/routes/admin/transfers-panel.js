/**
 * The 다운로드 기록 section at the top of the admin page's logs tab: how fast
 * each download went and which way it came in (터널, 전용 주소, 집 안, 기타).
 * Cards sum up the last 24 hours per route; the table lists transfers still
 * running first, with their live speed, then finished ones. While the section
 * is on screen it reads /admin/api/transfers every few seconds, and draws the
 * paged grid again only when something in it changed.
 */

import { top, topLabel } from "./top-i18n.js";

export const TRANSFERS_HTML = `
  <div class="hd"><h2 class="first">${top("xf.h2")}</h2>
    <div class="seg" id="xf-routes" role="group" ${topLabel("xf.routeLabel")}>
      <button type="button" data-route="" aria-pressed="true" class="active">${top("xf.kAll")}</button>
      <button type="button" data-route="tunnel" aria-pressed="false">${top("xf.kTunnel")}</button>
      <button type="button" data-route="direct" aria-pressed="false">${top("xf.kDirect")}</button>
      <button type="button" data-route="lan" aria-pressed="false">${top("xf.kLan")}</button>
      <button type="button" data-route="other" aria-pressed="false">${top("xf.kOther")}</button>
    </div></div>
  <p class="muted">${top("xf.lede1")}<span id="xf-quiet">20</span>${top("xf.lede2")}</p>
  <div class="cards xf-cards" id="xf-cards"></div>
  <div class="note warn" id="xf-slow" hidden></div>
  <div class="xf-table" id="xf-table" data-skel ${topLabel("xf.h2")}></div>
  <p class="muted" id="xf-foot"></p>`;

export const TRANSFERS_CSS = `
.xf-cards .card .v{font-size:var(--fs-2xl)}
.xf-cards .card .s{color:var(--muted);font-size:var(--fs-xs);margin-top:2px;font-variant-numeric:tabular-nums}
.xf-cards .card.slow{border-color:rgba(var(--warn-rgb),.6)}.xf-cards .card.slow .v{color:var(--warn)}
.xf-cards .card.fast .v{color:var(--good)}
#tab-logs .hd .seg{flex-wrap:wrap}
.xf-table .gc{font-variant-numeric:tabular-nums}
.xf-table .gc.xf-client{color:var(--muted);font-size:var(--fs-xs)}
`;

export const TRANSFERS_SCRIPT = /* js */ `
// var: showTab() can run before this part of the script.
var xfRoute='',xfTimer=null,xfLoaded=false,xfBusy=false,xfLastSig='';
const XF_ROUTE={tunnel:'xf.kTunnel',direct:'xf.kDirect',lan:'xf.kLan',other:'xf.kOther'};
const XF_PILL={tunnel:'warn',direct:'on',lan:'on',other:''};
const XF_COLS=['lo.colFile','lg.colTime','xf.colWho','rv.colSize','xf.colBytes','xf.colSpeed','xf.routeLabel','xf.colConn','xf.colClient'];
const xfSize=(n)=>{if(n==null)return '—';if(n>=1e9)return (n/1e9).toFixed(2)+' GB';if(n>=1e6)return (n/1e6).toFixed(1)+' MB';return Math.round(n/1e3)+' KB';};
const xfSpeed=(v)=>v==null?'—':v.toFixed(1)+' MB/s';
const xfWhen=(t)=>new Date(t).toLocaleString(loc(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
function xfCell(tr,main,sub,cls){const c=td(null,cls);
  if(main instanceof Node)c.append(main);else c.append(document.createTextNode(main));if(sub)c.append(el('span',sub,'sub'));tr.append(c);return c;}
function xfRow([r,live]){const tr=el('tr',null,live?'live':'');tr.dataset.id=r.id;
  const name=xfCell(tr,r.file.name,null,'xf-name');name.title=r.file.path||r.file.name;
  xfCell(tr,live?pill(topText('xf.live'),'on'):xfWhen(r.endedAt),live?topFill('xf.started',{v:ago(r.startedAt)}):null);
  const where=(r.remote&&r.remote.scope==='private'?topText('xf.fromHome'):topText('xf.fromOutside'))+(r.remote&&r.remote.country?' · '+r.remote.country:'');
  const who=xfCell(tr,r.who.label,where);if(r.who.kind==='ip')who.classList.add('ip');
  xfCell(tr,xfSize(r.fileSize));
  xfCell(tr,xfSize(r.bytes),r.complete?topText('xf.full'):(live?null:topText('xf.partial')));
  xfCell(tr,xfSpeed(r.mbps),r.requests?topFill('xf.requestsN',{n:num(r.requests)}):null);
  xfCell(tr,pill(XF_ROUTE[r.route]?topText(XF_ROUTE[r.route]):r.route,XF_PILL[r.route]));
  xfCell(tr,String(r.peakConnections||0),live?topFill('xf.nowN',{n:num(r.inflight||0)}):topText('xf.peak'));
  xfCell(tr,r.client||'—',null,'xf-client');
  return tr;}
function xfRender(d){const list=[...d.active.map((r)=>[r,true]),...d.recent.map((r)=>[r,false])];
  $('xf-foot').textContent=d.total>d.recent.length?topFill('xf.footMore',{shown:num(d.recent.length),total:num(d.total)}):'';
  $('xf-quiet').textContent=d.quietSeconds;
  // Polled every few seconds: drawing the same page again would only close an open row.
  const sig=JSON.stringify([xfRoute,list]);if(sig===xfLastSig)return;xfLastSig=sig;
  pagedTable('xf-table',XF_COLS.map(topText),list,xfRow,xfRoute?topFill('xf.noRoute',{route:topText(XF_ROUTE[xfRoute])}):topText('xf.none'),
    {label:topText('xf.h2'),placeholder:topText('xf.searchPh'),def:25,match:([r],q)=>JSON.stringify(r).toLowerCase().includes(q)});}
function xfCards(s){const box=$('xf-cards');box.replaceChildren();
  const fast=Math.max(s.direct.medianMbps||0,s.lan.medianMbps||0);
  const slowTunnel=s.tunnel.medianMbps!=null&&fast>0&&fast>=s.tunnel.medianMbps*2;
  for(const k of ['tunnel','direct','lan','other']){const v=s[k];if(k==='other'&&!v.count)continue;
    const c=el('div',null,'card'+(k==='tunnel'&&slowTunnel?' slow':'')+(slowTunnel&&k!=='tunnel'&&v.medianMbps===fast?' fast':''));
    c.append(el('div',xfSpeed(v.medianMbps),'v'),el('div',topFill('xf.cardLabel',{route:topText(XF_ROUTE[k])}),'l'),
      el('div',v.count?topFill('xf.cardCount',{n:num(v.count),best:xfSpeed(v.bestMbps)}):topText('xf.noTransfers'),'s'));box.append(c);}
  const slow=$('xf-slow');slow.hidden=!slowTunnel;
  if(slowTunnel){const via=(s.direct.medianMbps||0)>=(s.lan.medianMbps||0)?topText('xf.kDirect'):topText('xf.kLan');
    slow.textContent=topFill('xf.slowWarn',{via,tun:xfSpeed(s.tunnel.medianMbps),fast:xfSpeed(fast)});}}
async function xfLoad(){if(xfBusy)return;xfBusy=true;
  try{const d=await api('/admin/api/transfers?limit=200'+(xfRoute?'&route='+xfRoute:''));xfCards(d.summary);xfRender(d);xfLoaded=true;}
  catch(err){if(!xfLoaded)toast(err.message);}finally{xfBusy=false;}}
function xfVisible(){const t=$('tab-logs');return (t?!t.hidden:true)&&document.visibilityState==='visible';}
function xfOpen(){if(!xfLoaded&&!$('xf-table').childNodes.length)$('xf-table').append(el('div',topText('xf.loading'),'empty'));xfLoad();
  if(!xfTimer)xfTimer=setInterval(()=>{if(xfVisible())xfLoad();else{clearInterval(xfTimer);xfTimer=null;}},3000);}
document.addEventListener('visibilitychange',()=>{if(xfVisible())xfOpen();});
$('xf-routes').addEventListener('click',(e)=>{const b=e.target.closest('[data-route]');if(!b)return;xfRoute=b.dataset.route;
  for(const x of $('xf-routes').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}
  xfLoad();});
`;
