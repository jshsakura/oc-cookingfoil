/**
 * The admin page's 임시 공유 tab: what signed-in users left in the share inbox,
 * newest first, with their files to download, 정리함 to set one aside and
 * delete. Talks to /admin/api/inbox.
 */

export const INBOX_HTML = `<section id="tab-inbox" hidden>
  <div class="hd"><h2 class="first">임시 공유</h2>
    <div class="seg" id="ib-show" role="group" aria-label="보기">
      <button type="button" data-show="open" aria-pressed="true" class="active">정리할 것</button>
      <button type="button" data-show="done" aria-pressed="false">정리함</button>
      <button type="button" data-show="all" aria-pressed="false">전체</button>
    </div></div>
  <p class="muted">로그인한 사용자가 웹 화면에서 남긴 파일, 메모, 링크입니다. 패치, 세이브, 홈브류로 옮긴 것은 정리함으로 보내면 목록에서 숨깁니다. 서버의 data/inbox 폴더에도 그대로 있습니다.</p>
  <p class="muted" id="ib-usage"></p>
  <div class="ib-list" id="ib-list"></div>
</section>`;

export const INBOX_CSS = `
#tab-inbox .hd .seg{margin:22px 0 10px}
.ib-list{display:grid;gap:12px}
.ib-entry{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 16px;display:grid;gap:10px;min-width:0}
.ib-entry.done{opacity:.7}
.ib-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.ib-head b{font-size:15px}
.ib-entry a{color:var(--text)}
.ib-entry .row-actions{display:flex;gap:6px;flex-wrap:wrap}
.ib-memo{margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:14px;line-height:1.6}
.ib-entry ul{margin:0;padding:0;list-style:none;display:grid;gap:4px}
.ib-entry li{display:flex;justify-content:space-between;gap:12px;font-size:13px;min-width:0}
.ib-entry li a{overflow-wrap:anywhere;min-width:0}
.ib-entry li span{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.ib-entry h4{margin:0 0 4px;font-size:12px;color:var(--muted);font-weight:700}
`;

export const INBOX_SCRIPT = /* js */ `
var ibShow='open'; // var: the first showTab() can run before this line
const ibSize=(n)=>{if(!n)return '0 B';const u=['B','KB','MB','GB','TB'];const i=Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return i?(n/1024**i).toFixed(1)+' '+u[i]:n+' B';};
function ibCard(e){const card=el('article',null,'ib-entry'+(e.done?' done':''));card.dataset.id=e.id;
  const head=el('div',null,'ib-head');const when=el('span',ago(Date.parse(e.at)),'muted');when.title=fmt(Date.parse(e.at));
  head.append(el('b',e.user),when,pill('파일 '+e.files.length+'개 · '+ibSize(e.bytes)));if(e.done)head.append(pill('정리함','on'));card.append(head);
  if(e.memo)card.append(el('p',e.memo,'ib-memo'));
  if(e.links.length){const box=el('div');box.append(el('h4','링크'));const ul=el('ul');
    for(const u of e.links){const li=el('li');const a=el('a',u);a.href=u;a.target='_blank';a.rel='noopener noreferrer';li.append(a);ul.append(li);}box.append(ul);card.append(box);}
  if(e.files.length){const box=el('div');box.append(el('h4','파일'));const ul=el('ul');
    for(const f of e.files){const li=el('li');const a=el('a',f.name);a.href=f.url;a.download='';li.append(a,el('span',ibSize(f.size)));ul.append(li);}box.append(ul);card.append(box);}
  const acts=el('div',null,'row-actions');
  acts.append(btn(e.done?'정리할 것으로 되돌리기':'정리함으로',async()=>{try{await api('/admin/api/inbox/'+e.id+'/done',{method:'POST',body:{done:!e.done}});
    toast(e.done?'정리할 것으로 되돌렸습니다.':'정리함으로 옮겼습니다.');loadInbox();}catch(err){toast(err.message);}}));
  acts.append(btn('삭제',async()=>{if(!confirm(e.user+' 님이 남긴 것을 파일까지 지울까요? 되돌릴 수 없습니다.'))return;
    try{await api('/admin/api/inbox/'+e.id,{method:'DELETE'});toast('지웠습니다.');loadInbox();}catch(err){toast(err.message);}},'danger'));
  card.append(acts);return card;}
async function loadInbox(){let d;try{d=await api('/admin/api/inbox?show='+ibShow);}catch(err){toast(err.message);return;}
  const list=$('ib-list');
  list.replaceChildren(...(d.entries.length?d.entries.map(ibCard):[el('div',ibShow==='done'?'정리함이 비어 있습니다.':'남긴 것이 없습니다.','empty')]));
  $('ib-usage').textContent=(d.enabled?'켜져 있습니다. ':'꺼져 있습니다. 설정 탭에서 켭니다. ')+'쓰는 공간 '+ibSize(d.usage)+' / '+ibSize(d.quota)+', 한 번에 '+ibSize(d.maxBytes)+'까지 받습니다.';
  if(ibShow==='open')ibBadge(d.entries.length);}
function ibBadge(n){const c=$('inbox-count');c.hidden=!n;c.textContent=n;}
$('ib-show').addEventListener('click',(e)=>{const b=e.target.closest('[data-show]');if(!b)return;ibShow=b.dataset.show;
  for(const x of $('ib-show').querySelectorAll('button')){const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));}loadInbox();});
api('/admin/api/inbox?show=open').then((d)=>ibBadge(d.entries.length),()=>{});
`;
