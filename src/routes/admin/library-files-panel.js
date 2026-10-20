/**
 * The library tab's game files: found by name, title id or path, and deleted
 * one at a time. Talks to /admin/api/library/files. Below it, the file check
 * (/admin/api/library/verify): counts by verdict, the modified and damaged
 * files with 다시 검사, and 전체 해시 검사. The check only informs.
 */

export const LIBRARY_FILES_HTML = `<h2>게임 파일</h2>
  <p class="muted">라이브러리의 게임, 업데이트, DLC 파일을 찾아 삭제합니다. 지우면 서버의 games 폴더에서 사라지고 목록을 다시 읽습니다.</p>
  <div class="pt-tools"><input id="lf-q" type="search" autocomplete="off" spellcheck="false" placeholder="게임 이름, 타이틀 ID, 파일 이름" aria-label="게임 파일 찾기"></div>
  <p class="muted" id="lf-count"></p>
  <div class="scroll" id="lf-list"></div>`;

export const LIBRARY_VERIFY_HTML = `  <div class="hd"><h2 class="first">파일 검사</h2><button type="button" id="lv-hash-all">전체 해시 검사</button></div>
  <p class="muted">게임 파일의 서명을 모두 확인하고, 새로 들어온 파일은 해시까지 확인합니다. 결과는 안내로만 보여 주고 다운로드는 막지 않습니다. 수정된 파일은 개조나 한글패치처럼 원본과 다른 파일이고, 손상된 파일은 설치나 실행이 안 될 수 있습니다.</p>
  <p class="muted" id="lv-state"></p>
  <div class="cards" id="lv-cards"></div>
  <div class="scroll" id="lv-list" data-skel></div>`;

export const LIBRARY_FILES_SCRIPT = /* js */ `
const LF_KIND={base:'본편',update:'업데이트',dlc:'DLC'};
let lfFind=0,lfTimer=null;
async function lfSearch(){const q=$('lf-q').value.trim();const n=++lfFind;
  if(!q){$('lf-list').replaceChildren();$('lf-count').textContent='찾을 이름을 넣으면 맞는 파일이 나옵니다.';return;}
  let d;try{d=await api('/admin/api/library/files?q='+encodeURIComponent(q));}catch(err){toast(err.message);return;}if(n!==lfFind)return;
  $('lf-count').textContent='파일 '+d.total.toLocaleString()+'개 중 '+d.matched+'개가 맞습니다'+(d.matched>d.files.length?'. 앞의 '+d.files.length+'개만 보여 줍니다.':'.');
  table('lf-list',['파일','종류','크기',''],d.files.map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.name));n.append(el('div',f.rel,'muted'));
    const del=btn('삭제',()=>lfRemove(f),'danger');del.setAttribute('aria-label',f.rel+' 삭제');const a=td();a.append(del);
    tr.append(n,td(LF_KIND[f.kind]||'—'),td(mb(f.size)),a);return tr;}),'맞는 파일이 없습니다.');}
async function lfRemove(f){if(!await ask(f.rel+' 파일을 서버에서 삭제합니다. 되돌릴 수 없습니다.'))return;
  try{await api('/admin/api/library/files/remove',{method:'POST',body:{rel:f.rel}});toast('삭제했습니다.');setTimeout(lfSearch,1500);}catch(err){toast(err.message);}}
$('lf-q').addEventListener('input',()=>{clearTimeout(lfTimer);lfTimer=setTimeout(lfSearch,250);});
const LV_VERDICT={modified:'수정됨',damaged:'손상됨'};
const LV_REASON={'signature-fail':'NCA 서명이 맞지 않습니다','hash-mismatch':'내용 해시가 맞지 않습니다','missing-content':'목록에 있는 NCA 가 없습니다','unreadable':'파일을 읽지 못했습니다'};
const LV_STATUS={running:'검사하는 중입니다',waiting:'검사할 파일이 기다리고 있습니다',downloads:'다운로드가 끝나면 이어서 검사합니다',schedule:'설정한 검사 시간에 이어서 합니다',tool:'nstool 이나 키가 없어 검사하지 않습니다',paused:'잇달아 실패해 멈췄습니다. 다시 검사를 누르면 이어 갑니다',stopped:'검사를 중지했습니다. 라이브러리가 바뀌거나 다시 검사를 누르면 이어 갑니다',idle:'모두 검사했습니다'};
async function lvLoad(){let d;try{d=await api('/admin/api/library/verify');}catch(err){toast(err.message);return;}
  const c=d.counts||{};const cards=$('lv-cards');cards.replaceChildren();
  const card=(l,v,cls)=>{const e=el('div',null,'card'+(cls?' '+cls:''));e.append(el('div',num(v),'v'),el('div',l,'l'));return e;};
  cards.append(card('정상',c.ok||0),card('수정됨',c.modified||0),card('손상됨',c.damaged||0,c.damaged?'alert':''),card('검사 전',c.unchecked||0));
  $('lv-state').textContent=(LV_STATUS[d.status]||'')+(d.current?' ('+d.current.path+')':'')+'. 남은 파일 '+num(d.pending)+'개, 해시를 기다리는 파일 '+num(d.hashPending)+'개입니다.';
  table('lv-list',['파일','결과','이유',''],(d.flagged||[]).map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.path.split('/').pop()));n.append(el('div',f.path,'muted'));
    const again=btn('다시 검사',()=>lvRecheck(f));again.setAttribute('aria-label',f.path+' 다시 검사');const a=td();a.append(again);
    tr.append(n,td(LV_VERDICT[f.verdict]||f.verdict),td(LV_REASON[f.reason]||f.reason||'—'),a);return tr;}),'수정되거나 손상된 파일이 없습니다.');}
async function lvRecheck(f){try{await api('/admin/api/library/verify/recheck',{method:'POST',body:{rel:f.path}});toast('다시 검사합니다.');lvLoad();}catch(err){toast(err.message);}}
$('lv-hash-all').addEventListener('click',async()=>{
  if(!await ask('아직 해시를 확인하지 않은 모든 게임 파일을 처음부터 끝까지 읽습니다. 라이브러리가 크면 며칠이 걸리고, 다운로드가 있으면 그동안 쉽니다.'))return;
  try{const r=await api('/admin/api/library/verify/hash-all',{method:'POST',body:{}});toast('해시 검사에 '+num(r.queued)+'개를 넣었습니다.');lvLoad();}catch(err){toast(err.message);}});
`;
