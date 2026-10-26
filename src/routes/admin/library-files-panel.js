/**
 * The library tab's file check (/admin/api/library/verify): counts by verdict, the modified
 * and damaged files with 다시 검사, and 전체 해시 검사. The check only informs.
 * Finding and deleting game files lives in the file browser (library-browser-panel.js);
 * GET/POST /admin/api/library/files stay for tokens and older clients.
 */

export const LIBRARY_VERIFY_HTML = `  <div class="hd"><h2 class="first">파일 검사</h2><button type="button" id="lv-hash-all">전체 해시 검사</button></div>
  <p class="muted">게임 파일의 서명을 모두 확인하고, 새로 들어온 파일은 해시까지 확인합니다. 결과는 안내로만 보여 주고 다운로드는 막지 않습니다. 수정된 파일은 개조나 한글패치처럼 원본과 다른 파일이고, 손상된 파일은 설치나 실행이 안 될 수 있습니다.</p>
  <p class="muted" id="lv-state"></p>
  <div class="cards" id="lv-cards"></div>
  <div class="scroll" id="lv-list" data-skel></div>`;

export const LIBRARY_FILES_CSS = /* css */ `
#lv-list .lv-why{display:inline-flex;align-items:center;gap:6px;max-width:100%}
#lv-list .lv-why-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#lv-list .lv-tip{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:help}
#lv-list .lv-tip:hover,#lv-list .lv-tip:focus-visible{background:var(--sunk);color:var(--text)}
#lv-list .lv-tip svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lv-pop{position:fixed;z-index:60;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);color:var(--text);box-shadow:0 10px 30px var(--shadow);font-size:var(--fs-sm);line-height:1.55;pointer-events:none}
.lv-pop b{display:block;margin-bottom:6px;font-size:var(--fs-sm)}
.lv-pop p{margin:0 0 6px;color:var(--muted)}
.lv-pop p:last-child{margin-bottom:0}
`;

export const LIBRARY_FILES_SCRIPT = /* js */ `
const LV_VERDICT={modified:'수정됨',damaged:'손상됨',misnamed:'이름 다름'};
const LV_REASON={'signature-fail':'NCA 서명이 맞지 않습니다','hash-mismatch':'내용 해시가 맞지 않습니다','missing-content':'목록에 있는 NCA 가 없습니다','unreadable':'파일을 읽지 못했습니다','name-mismatch':'파일 이름의 타이틀 ID 가 파일 안의 ID 와 다릅니다'};
const LV_STATUS={running:'검사하는 중입니다',waiting:'검사할 파일이 기다리고 있습니다',downloads:'다운로드가 끝나면 이어서 검사합니다',schedule:'설정한 검사 시간에 이어서 합니다',tool:'nstool 이나 키가 없어 검사하지 않습니다',paused:'잇달아 실패해 멈췄습니다. 다시 검사를 누르면 이어 갑니다',stopped:'검사를 중지했습니다. 라이브러리가 바뀌거나 다시 검사를 누르면 이어 갑니다',idle:'모두 검사했습니다'};
async function lvLoad(){let d;try{d=await api('/admin/api/library/verify');}catch(err){toast(err.message);return;}
  const c=d.counts||{};const cards=$('lv-cards');cards.replaceChildren();
  const card=(l,v,cls)=>{const e=el('div',null,'card'+(cls?' '+cls:''));e.append(el('div',num(v),'v'),el('div',l,'l'));return e;};
  cards.append(card('정상',c.ok||0),card('수정됨',c.modified||0),card('손상됨',c.damaged||0,c.damaged?'alert':''),card('검사 전',c.unchecked||0),card('이름 다름',c.misnamed||0));
  $('lv-state').textContent=(LV_STATUS[d.status]||'')+(d.current?' ('+d.current.path+')':'')+'. 남은 파일 '+num(d.pending)+'개, 해시를 기다리는 파일 '+num(d.hashPending)+'개입니다.';
  table('lv-list',[topText('lo.colFile'),'결과',topText('lo.colReason'),''],(d.flagged||[]).map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.path.split('/').pop()));n.append(el('div',f.path,'muted'));
    const again=btn('다시 검사',()=>lvRecheck(f));again.setAttribute('aria-label',f.path+' 다시 검사');const a=td();a.append(again);
    tr.append(n,td(f.label||LV_VERDICT[f.verdict]||f.verdict),lvReason(f),a);return tr;}),'수정되거나 손상된 파일, 이름이 다른 파일이 없습니다.');}
// The reason on one line; the help the server wrote in the admin's language opens beside it, over the table, on hover, focus or tap.
const LV_INFO='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
function lvReason(f){const c=td();const text=(f.help&&f.help.title)||(LV_REASON[f.reason]||f.reason||'—')+(f.contentId?'. 파일 안의 ID 는 '+f.contentId+' 입니다':'');
  const w=el('span',null,'lv-why');w.append(el('span',text,'lv-why-t'));
  if(f.help){const b=el('button',null,'lv-tip');b.type='button';b.innerHTML=LV_INFO;b.setAttribute('aria-label',f.help.title);
    b.addEventListener('mouseenter',()=>lvTipShow(b,f.help));b.addEventListener('mouseleave',lvTipHide);
    b.addEventListener('focus',()=>lvTipShow(b,f.help));b.addEventListener('blur',lvTipHide);
    b.addEventListener('click',(e)=>{e.stopPropagation();lvTip&&lvTip.owner===b&&!lvTip.hidden?lvTipHide():lvTipShow(b,f.help);});
    w.append(b);}
  c.append(w);return c;}
let lvTip=null;
function lvTipShow(owner,help){
  if(!lvTip){lvTip=el('div',null,'lv-pop');lvTip.setAttribute('role','tooltip');lvTip.id='lv-pop';document.body.append(lvTip);
    document.addEventListener('click',(e)=>{if(!lvTip.contains(e.target))lvTipHide();});
    document.addEventListener('keydown',(e)=>{if(e.key==='Escape')lvTipHide();});
    window.addEventListener('scroll',lvTipHide,true);}
  lvTip.replaceChildren(el('b',help.title));for(const para of help.body.split('\\n\\n'))lvTip.append(el('p',para));
  lvTip.owner=owner;owner.setAttribute('aria-describedby','lv-pop');lvTip.hidden=false;
  const r=owner.getBoundingClientRect(),gap=8,vw=document.documentElement.clientWidth,vh=window.innerHeight;
  const w=Math.min(380,vw-24);lvTip.style.width=w+'px';
  const h=lvTip.offsetHeight;const below=r.bottom+gap+h<=vh-12;
  lvTip.style.top=Math.max(12,below?r.bottom+gap:r.top-gap-h)+'px';
  lvTip.style.left=Math.min(Math.max(12,r.left+r.width/2-w/2),vw-w-12)+'px';}
function lvTipHide(){if(!lvTip||lvTip.hidden)return;lvTip.hidden=true;lvTip.owner&&lvTip.owner.removeAttribute('aria-describedby');}
async function lvRecheck(f){try{await api('/admin/api/library/verify/recheck',{method:'POST',body:{rel:f.path}});toast('다시 검사합니다.');lvLoad();}catch(err){toast(err.message);}}
$('lv-hash-all').addEventListener('click',async()=>{
  if(!await ask('아직 해시를 확인하지 않은 모든 게임 파일을 처음부터 끝까지 읽습니다. 라이브러리가 크면 며칠이 걸리고, 다운로드가 있으면 그동안 쉽니다.'))return;
  try{const r=await api('/admin/api/library/verify/hash-all',{method:'POST',body:{}});toast('해시 검사에 '+num(r.queued)+'개를 넣었습니다.');lvLoad();}catch(err){toast(err.message);}});
`;
