/**
 * The library tab's 임시 폴더 area: what the drop box (games/incoming) sorted
 * lately and what it keeps with why. Talks to /admin/api/library/organize.
 */

export const ORGANIZE_HTML = `  <div class="hd"><h2 class="first">임시 폴더</h2><div class="actions"><button type="button" class="primary" id="lo-sweep">지금 정리</button></div></div>
  <p class="muted">게임 폴더 안의 <b>incoming</b> 폴더에 스위치 게임 파일을 넣으면 서버가 알아서 정리합니다. 파일 안의 정보로 게임과 버전을 알아내 파일 이름에 [타이틀 ID][v버전] 을 붙이고, 게임마다 폴더 하나에 본편, update, DLC 로 나눠 넣습니다. 게임 폴더에 이미 그 게임의 폴더가 있으면 그 폴더를 쓰고, 없으면 게임 이름으로 새로 만듭니다. 복사가 끝나고 1분 동안 바뀌지 않은 파일부터 옮기며, 게임 폴더에 이미 있던 파일은 건드리지 않습니다.</p>
  <p class="muted" id="lo-state"></p>
  <h3>남아 있는 파일</h3><div id="lo-held"></div>
  <h3>최근에 옮긴 파일</h3><div id="lo-recent"></div>`;

export const ORGANIZE_SCRIPT = /* js */ `
const LO_KIND={base:'본편',update:'업데이트',dlc:'DLC',delta:'델타'};
let loTimer=null;
function loCell(main,sub){const c=td();c.append(el('b',main));if(sub)c.append(el('div',sub,'muted'));return c;}
function loRender(d){clearTimeout(loTimer);
  $('lo-sweep').disabled=d.running;
  $('lo-state').textContent=d.error||(d.sweptAt?new Date(d.sweptAt).toLocaleString()+' 에 확인했습니다.'+(d.waiting?' 복사 중인 파일 '+num(d.waiting)+'개는 끝나면 옮깁니다.':''):'아직 확인하지 않았습니다.');
  table('lo-held',['파일','이유','종류'],(d.held||[]).map((h)=>{const tr=el('tr');tr.append(loCell(h.rel.split('/').pop(),'incoming/'+h.rel),td(h.reason),td(LO_KIND[h.kind]||'-'));return tr;}),'임시 폴더가 비어 있습니다.');
  table('lo-recent',['파일','옮긴 곳','종류','옮긴 때'],(d.recent||[]).map((m)=>{const tr=el('tr');tr.append(loCell(m.to.split('/').pop(),'incoming/'+m.from),loCell(m.to,m.folderIsNew?'새 폴더':''),td(LO_KIND[m.kind]||m.kind),td(new Date(m.at).toLocaleString()));return tr;}),'아직 옮긴 파일이 없습니다.');
  if(d.running||d.waiting)loTimer=setTimeout(loLoad,5000);}
async function loLoad(){try{loRender(await api('/admin/api/library/organize'));}catch(err){toast(err.message);}}
$('lo-sweep').addEventListener('click',async()=>{$('lo-sweep').disabled=true;
  try{const d=await api('/admin/api/library/organize/sweep',{method:'POST',body:{}});toast(d.moved?num(d.moved)+'개 옮겼습니다':'옮길 파일이 없습니다');loRender(d);}
  catch(err){toast(err.message);loLoad();}});
`;
