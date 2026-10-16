/**
 * The library tab's game files: found by name, title id or path, and deleted
 * one at a time. Talks to /admin/api/library/files.
 */

export const LIBRARY_FILES_HTML = `<h2>게임 파일</h2>
  <p class="muted">라이브러리의 게임, 업데이트, DLC 파일을 찾아 지웁니다. 지우면 서버의 games 폴더에서 사라지고 목록을 다시 읽습니다.</p>
  <div class="pt-tools"><input id="lf-q" type="search" autocomplete="off" spellcheck="false" placeholder="게임 이름, 타이틀 ID, 파일 이름" aria-label="게임 파일 찾기"></div>
  <p class="muted" id="lf-count"></p>
  <div class="scroll" id="lf-list"></div>`;

export const LIBRARY_FILES_SCRIPT = /* js */ `
const LF_KIND={base:'본편',update:'업데이트',dlc:'DLC'};
let lfFind=0,lfTimer=null;
async function lfSearch(){const q=$('lf-q').value.trim();const n=++lfFind;
  if(!q){$('lf-list').replaceChildren();$('lf-count').textContent='찾을 이름을 넣으면 맞는 파일이 나옵니다.';return;}
  let d;try{d=await api('/admin/api/library/files?q='+encodeURIComponent(q));}catch(err){toast(err.message);return;}if(n!==lfFind)return;
  $('lf-count').textContent='파일 '+d.total.toLocaleString()+'개 중 '+d.matched+'개가 맞습니다'+(d.matched>d.files.length?'. 앞의 '+d.files.length+'개만 보여 줍니다.':'.');
  table('lf-list',['파일','종류','크기',''],d.files.map((f)=>{const tr=el('tr');const n=td();n.append(el('b',f.name));n.append(el('div',f.rel,'muted'));
    const del=btn('지우기',()=>lfRemove(f),'danger');del.setAttribute('aria-label',f.rel+' 지우기');const a=td();a.append(del);
    tr.append(n,td(LF_KIND[f.kind]||'—'),td(mb(f.size)),a);return tr;}),'맞는 파일이 없습니다.');}
async function lfRemove(f){if(!await ask(f.rel+' 파일을 서버에서 지웁니다. 되돌릴 수 없습니다.'))return;
  try{await api('/admin/api/library/files/remove',{method:'POST',body:{rel:f.rel}});toast('지웠습니다.');setTimeout(lfSearch,1500);}catch(err){toast(err.message);}}
$('lf-q').addEventListener('input',()=>{clearTimeout(lfTimer);lfTimer=setTimeout(lfSearch,250);});
`;
