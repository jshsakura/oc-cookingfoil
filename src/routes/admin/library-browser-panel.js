/**
 * The library tab's file browser: one list per kind (게임, 업데이트, DLC, 패치,
 * 세이브, 홈브류, 기타) with its count, a search and sort inside the kind, and
 * pages of 50 cut on the server (GET /admin/api/library/browse). Read only.
 * Everything is scoped under #lib-files so it never restyles the rest of the page.
 */

// Line icons in the same 24px stroke style as views/icons.js, kept here so
// this panel does not touch the shared icon list.
const PATHS = {
  base: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>',
  update: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  dlc: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
  patch: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  homebrew: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  other: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 13a2 2 0 1 1 2.5 1.94V16M12 19h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  asc: '<path d="M3 8l4-4 4 4M7 4v16M13 8h8M13 12h6M13 16h4"/>',
  desc: '<path d="M3 16l4 4 4-4M7 20V4M13 8h4M13 12h6M13 16h8"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
};
const svg = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;

const KINDS = [["base", "게임"], ["update", "업데이트"], ["dlc", "DLC"], ["patch", "패치"], ["save", "세이브"], ["homebrew", "홈브류"], ["other", "기타"]];

export const LIB_BROWSER_CSS = /* css */ `
#lib-files{display:grid;gap:12px;margin-bottom:8px}
#lib-files .lb-kinds{position:relative;display:flex;gap:4px;padding:5px;background:var(--sunk);border:1px solid var(--line);border-radius:16px;overflow-x:auto;scrollbar-width:none}
#lib-files .lb-kinds::-webkit-scrollbar{display:none}
#lib-files .lb-ind{position:absolute;left:0;top:0;width:0;height:0;border-radius:12px;background:var(--panel);box-shadow:0 1px 3px var(--shadow),0 0 0 1px var(--line2);transition:transform .28s cubic-bezier(.3,.7,.2,1),width .28s cubic-bezier(.3,.7,.2,1),height .28s;pointer-events:none}
#lib-files .lb-kinds button{position:relative;z-index:1;flex:1 0 auto;gap:7px;padding:8px 12px;border:0;border-radius:12px;background:none;color:var(--muted);white-space:nowrap;transition:color .15s,transform .12s}
#lib-files .lb-kinds button:hover{color:var(--text)}
#lib-files .lb-kinds button[aria-selected="true"]{color:var(--text)}
#lib-files .lb-n{min-width:22px;padding:1px 7px;border-radius:100px;background:var(--line2);color:var(--text);font-size:11px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums;transition:background .2s,color .2s}
#lib-files .lb-kinds button[aria-selected="true"] .lb-n{background:var(--accent);color:var(--accent-ink)}
#lib-files .lb-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0}
#lib-files .lb-q{position:relative;flex:1 1 260px;display:flex}
#lib-files .lb-q .ico{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
#lib-files .lb-q input{width:100%;padding-left:38px}
#lib-files .lb-bar select{flex:0 0 auto}
#lib-files button{transition:border-color .15s,background .15s,transform .12s,box-shadow .15s}
#lib-files button:not(:disabled):hover{box-shadow:0 2px 8px var(--shadow)}
#lib-files .lb-kinds button:not(:disabled):hover{box-shadow:none}
#lib-files button:not(:disabled):active{transform:scale(.96)}
#lib-files .lb-count{margin:0}
#lib-files .lb-list{min-height:120px}
#lib-files .lb-list.lb-in{animation:lb-in .26s ease-out}
@keyframes lb-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#lib-files td b{word-break:break-all}
#lib-files td .muted{word-break:break-all}
#lib-files td.lb-num{white-space:nowrap;font-variant-numeric:tabular-nums}
#lib-files .lb-skel td span{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--sunk) 0%,var(--line) 50%,var(--sunk) 100%);background-size:200% 100%;animation:lb-shimmer 1.2s linear infinite}
#lib-files .lb-skel td span.w2{width:40%;margin-top:6px;height:10px}
@keyframes lb-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
#lib-files .lb-pager{display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap}
#lib-files .lb-pager[hidden]{display:none}
#lib-files .lb-pager .lb-pg{min-width:38px;padding:8px 10px;font-variant-numeric:tabular-nums}
#lib-files .lb-pager .lb-pg[aria-current="page"]{background:var(--text);color:var(--bg);border-color:var(--text)}
#lib-files .lb-pager .lb-gap{color:var(--faint);padding:0 2px}
@media (max-width:640px){
  #lib-files .lb-kinds{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:visible}
  #lib-files .lb-kinds button{flex-direction:column;gap:2px;padding:7px 2px;font-size:12px;min-width:0}
  #lib-files .lb-kinds button>span:not(.lb-n){overflow:hidden;text-overflow:ellipsis;max-width:100%}
  #lib-files .lb-bar select,#lib-files .lb-bar button{flex:1 1 0;min-width:0}
  #lib-files .lb-q{flex:1 1 100%}
  #lib-files .lb-pager .lb-pg.lb-far{display:none}
}
@media (prefers-reduced-motion:reduce){
  #lib-files .lb-ind,#lib-files button,#lib-files .lb-n{transition:none}
  #lib-files .lb-list.lb-in,#lib-files .lb-skel td span{animation:none}
  #lib-files button:not(:disabled):active{transform:none}
}
`;

export const LIB_BROWSER_HTML = `<h2>파일</h2>
  <p class="muted">서버가 내주는 파일을 종류별로 나눠 보여 줍니다. 기타는 게임 폴더에 있지만 게임 파일이 아닌 것입니다. 검색과 정렬은 고른 종류 안에서만 적용됩니다.</p>
  <div id="lib-files">
    <div class="lb-kinds" id="lb-kinds" role="tablist" aria-label="파일 종류">
      <span class="lb-ind" id="lb-ind" aria-hidden="true"></span>
      ${KINDS.map(([k, label], i) => `<button type="button" role="tab" id="lb-tab-${k}" data-kind="${k}" aria-controls="lb-list" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${svg(k)}<span>${label}</span><span class="lb-n" id="lb-n-${k}">0</span></button>`).join("")}
    </div>
    <form class="lb-bar" id="lb-bar" role="search">
      <label class="lb-q">${svg("search")}<input type="search" id="lb-q" autocomplete="off" spellcheck="false" maxlength="200" placeholder="이름, 경로, 타이틀 ID" aria-label="이 종류에서 찾기"></label>
      <button type="submit" id="lb-go">${svg("search")}<span>찾기</span></button>
      <select id="lb-sort" aria-label="정렬 기준"><option value="name">이름순</option><option value="size">크기순</option><option value="mtime">수정한 날짜순</option></select>
      <button type="button" id="lb-order" aria-label="정렬 방향: 오름차순" title="정렬 방향을 바꿉니다"><span id="lb-order-ico">${svg("asc")}</span><span id="lb-order-t">오름차순</span></button>
    </form>
    <p class="muted lb-count" id="lb-count" aria-live="polite"></p>
    <div class="lb-list" id="lb-list" role="tabpanel" aria-labelledby="lb-tab-base"></div>
    <nav class="lb-pager" id="lb-pager" aria-label="페이지" hidden></nav>
  </div>`;

export const LIB_BROWSER_SCRIPT = /* js */ `
const LB_ICON=${JSON.stringify({ prev: svg("prev"), next: svg("next"), asc: svg("asc"), desc: svg("desc") })};
const LB_KIND=${JSON.stringify(Object.fromEntries(KINDS))};
const LB_PER=50;
const LB_CHECK={ok:['정상','on'],modified:['수정됨','warn'],damaged:['손상됨','off'],unchecked:['검사 전','']};
const lb={kind:'base',page:1,sort:'name',order:'asc',q:'',seq:0,timer:null};
const lbSize=(n)=>{if(n==null)return '-';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+u[i];};
const lbDate=(s)=>s?new Date(s*1000).toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'}):'-';
function lbIndicator(){const t=$('lb-tab-'+lb.kind),ind=$('lb-ind');if(!t||!t.offsetWidth)return;
  ind.style.width=t.offsetWidth+'px';ind.style.height=t.offsetHeight+'px';ind.style.transform='translate('+t.offsetLeft+'px,'+t.offsetTop+'px)';}
function lbSkeleton(){const m=$('lb-list');m.replaceChildren();const t=el('table');
  for(let i=0;i<6;i++){const tr=el('tr',null,'lb-skel');const a=td();a.append(el('span'),el('span',null,'w2'));tr.append(a);
    for(let j=0;j<3;j++){const c=td();c.append(el('span'));tr.append(c);}t.append(tr);}m.append(t);}
function lbAnimate(){const m=$('lb-list');m.classList.remove('lb-in');void m.offsetWidth;m.classList.add('lb-in');}
function lbCols(kind){
  if(kind==='base'||kind==='update'||kind==='dlc')return ['파일','타이틀 ID','버전','크기','수정한 날짜','검사'];
  if(kind==='patch'||kind==='save')return ['파일','타이틀 ID','크기','수정한 날짜'];
  if(kind==='homebrew')return ['파일','버전','크기','수정한 날짜'];
  return ['파일','크기','수정한 날짜'];}
function lbRow(f,kind){const tr=el('tr');const n=td();n.append(el('b',f.name||'-'));if(f.rel)n.append(el('div',f.rel,'muted'));tr.append(n);
  const game=kind==='base'||kind==='update'||kind==='dlc';
  if(game||kind==='patch'||kind==='save')tr.append(td(f.titleId||'-','mono lb-num'));
  if(game||kind==='homebrew')tr.append(td(f.version!=null?(game?'v'+f.version:String(f.version)):'-','lb-num'));
  tr.append(td(lbSize(f.size),'lb-num'),td(lbDate(f.mtime),'lb-num'));
  if(game){const c=td();const v=LB_CHECK[f.integrity]||LB_CHECK.unchecked;c.append(pill(v[0],v[1]));tr.append(c);}
  return tr;}
function lbPageButton(label,page,{icon,current,far}={}){const b=el('button',null,'lb-pg'+(far?' lb-far':''));b.type='button';
  if(icon){b.innerHTML=icon;b.append(el('span',label));b.setAttribute('aria-label',label+' 페이지');}else{b.textContent=String(page);b.setAttribute('aria-label',page+' 페이지');}
  if(current)b.setAttribute('aria-current','page');
  b.addEventListener('click',()=>{if(page!==lb.page){lb.page=page;lbLoad();}});return b;}
function lbPager(d){const nav=$('lb-pager');nav.replaceChildren();nav.hidden=d.pages<=1;if(d.pages<=1)return;
  const prev=lbPageButton('이전',Math.max(1,d.page-1),{icon:LB_ICON.prev});prev.disabled=d.page<=1;nav.append(prev);
  const want=new Set([1,d.pages,d.page-2,d.page-1,d.page,d.page+1,d.page+2].filter((p)=>p>=1&&p<=d.pages));
  let last=0;for(const p of [...want].sort((a,b)=>a-b)){if(p-last>1)nav.append(el('span','…','lb-gap'));
    nav.append(lbPageButton('',p,{current:p===d.page,far:Math.abs(p-d.page)>1&&p!==1&&p!==d.pages}));last=p;}
  const next=lbPageButton('다음',Math.min(d.pages,d.page+1),{icon:LB_ICON.next});next.disabled=d.page>=d.pages;nav.append(next);}
async function lbLoad(){const n=++lb.seq;const kind=lb.kind;
  const skel=setTimeout(()=>{if(n===lb.seq)lbSkeleton();},150);
  const qs=new URLSearchParams({kind,page:String(lb.page),perPage:String(LB_PER),sort:lb.sort,order:lb.order});if(lb.q)qs.set('q',lb.q);
  let d;try{d=await api('/admin/api/library/browse?'+qs);}catch(err){clearTimeout(skel);if(n===lb.seq){$('lb-list').replaceChildren(el('div','목록을 불러오지 못했습니다. '+err.message,'empty'));}return;}
  clearTimeout(skel);if(n!==lb.seq)return;
  for(const k of Object.keys(LB_KIND))$('lb-n-'+k).textContent=num(d.counts[k]);
  lb.page=d.page;
  const empty=lb.q?'이 종류에는 맞는 파일이 없습니다.':LB_KIND[kind]+' 파일이 없습니다.';
  table('lb-list',lbCols(kind),d.items.map((f)=>lbRow(f,kind)),empty);lbAnimate();
  const from=d.total?(d.page-1)*d.perPage+1:0,to=Math.min(d.total,d.page*d.perPage);
  $('lb-count').textContent=d.total?LB_KIND[kind]+' '+num(d.total)+'개 중 '+num(from)+'에서 '+num(to)+'번째를 보여 줍니다.':'';
  lbPager(d);lbIndicator();}
function lbSelect(kind){if(kind===lb.kind)return;lb.kind=kind;lb.page=1;
  for(const b of $('lb-kinds').querySelectorAll('button[role=tab]')){const on=b.dataset.kind===kind;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  $('lb-list').setAttribute('aria-labelledby','lb-tab-'+kind);lbIndicator();lbLoad();}
$('lb-kinds').addEventListener('click',(e)=>{const b=e.target.closest('button[role=tab]');if(b)lbSelect(b.dataset.kind);});
$('lb-kinds').addEventListener('keydown',(e)=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const ks=Object.keys(LB_KIND);
  const i=(ks.indexOf(lb.kind)+(e.key==='ArrowRight'?1:-1)+ks.length)%ks.length;lbSelect(ks[i]);$('lb-tab-'+ks[i]).focus();e.preventDefault();});
$('lb-bar').addEventListener('submit',(e)=>{e.preventDefault();clearTimeout(lb.timer);lb.q=$('lb-q').value.trim();lb.page=1;lbLoad();});
$('lb-q').addEventListener('input',()=>{clearTimeout(lb.timer);lb.timer=setTimeout(()=>{const q=$('lb-q').value.trim();if(q===lb.q)return;lb.q=q;lb.page=1;lbLoad();},300);});
$('lb-sort').addEventListener('change',()=>{lb.sort=$('lb-sort').value;lb.order=lb.sort==='name'?'asc':'desc';lbOrderLabel();lb.page=1;lbLoad();});
function lbOrderLabel(){const asc=lb.order==='asc';$('lb-order-ico').innerHTML=asc?LB_ICON.asc:LB_ICON.desc;$('lb-order-t').textContent=asc?'오름차순':'내림차순';
  $('lb-order').setAttribute('aria-label','정렬 방향: '+(asc?'오름차순':'내림차순'));}
$('lb-order').addEventListener('click',()=>{lb.order=lb.order==='asc'?'desc':'asc';lbOrderLabel();lb.page=1;lbLoad();});
window.addEventListener('resize',()=>lbIndicator());
`;
