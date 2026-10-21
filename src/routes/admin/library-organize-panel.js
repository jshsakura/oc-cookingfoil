/**
 * The library tab's 임시 폴더 area: what the drop box (helpers/storage-layout.js) sorted
 * lately and what it keeps with why. Talks to /admin/api/library/organize.
 */

export const ORGANIZE_HTML = `  <div class="hd"><h2 class="first">임시 폴더</h2><div class="actions"><button type="button" class="primary" id="lo-sweep">지금 정리</button></div></div>
  <p class="muted"><b>incoming</b> 폴더(<code id="lo-path"></code>)에 파일을 넣으면 서버가 알아서 정리합니다. 복사가 끝나고 1분 동안 바뀌지 않은 파일부터 옮기고, 이미 있던 파일은 덮어쓰지 않습니다.</p>
  <ul class="muted lo-rules">
    <li><b>스위치 게임</b>은 파일 안의 정보로 게임과 버전을 알아내 이름에 [타이틀 ID][v버전] 을 붙이고, 게임마다 폴더 하나에 본편, update, DLC 로 나눠 넣습니다. 그 게임의 폴더가 이미 있으면 그 폴더를 씁니다.</li>
    <li><b>레트로 롬</b>은 기종 이름 폴더에 넣습니다(incoming/snes/게임.zip 처럼). 그 폴더 이름이 기종이 되고, 기종 폴더 밖에 넣은 롬이나 그 기종에서 쓰지 않는 확장자는 옮기지 않고 경고와 함께 남깁니다. .cue 와 .m3u 는 가리키는 파일과 함께 폴더째 갑니다.</li>
    <li><b>홈브류 .nro</b> 하나짜리는 홈브류 폴더로 보냅니다. 폴더째 쓰는 홈브류와 패치, 세이브는 업로드 탭에서 올립니다.</li>
  </ul>
  <details class="lo-systems"><summary>기종 폴더 이름</summary><p class="muted">아래 이름 가운데 하나로 폴더를 만듭니다. 대소문자는 가리지 않고, ES-DE 나 RetroArch 에서 쓰는 이름(SNES, psx, Nintendo - Game Boy Advance 등)도 됩니다.</p><div id="lo-systems"></div></details>
  <p class="muted" id="lo-state"></p>
  <h3>남아 있는 파일</h3><div id="lo-held"></div>
  <h3>최근에 옮긴 파일</h3><div id="lo-recent"></div>`;

export const ORGANIZE_CSS = `.lo-rules{margin:4px 0 12px;padding-left:20px;line-height:1.6}.lo-rules li{margin:2px 0}
.lo-systems{margin:0 0 12px}.lo-systems summary{cursor:pointer;font-weight:600}
#lo-systems{display:flex;flex-wrap:wrap;gap:6px}#lo-systems code{font-size:12.5px}`;

export const ORGANIZE_SCRIPT = /* js */ `
const LO_KIND={base:'본편',update:'업데이트',dlc:'DLC',delta:'델타'};
const LO_ROOT={games:'게임 폴더 ',retro:'레트로 폴더 ',homebrew:'홈브류 폴더 '};
let loTimer=null;
function loCell(main,sub){const c=td();c.append(el('b',main));if(sub)c.append(el('div',sub,'muted'));return c;}
function loRender(d){clearTimeout(loTimer);
  $('lo-sweep').disabled=d.running;
  $('lo-path').textContent=d.incoming||'';
  $('lo-systems').replaceChildren(...(d.systems||[]).map((s)=>{const p=pill('');p.replaceChildren(el('code',s.folder),document.createTextNode(' '+s.name));return p;}));
  $('lo-state').textContent=d.error||(d.sweptAt?new Date(d.sweptAt).toLocaleString()+' 에 확인했습니다.'+(d.waiting?' 복사 중인 파일 '+num(d.waiting)+'개는 끝나면 옮깁니다.':''):'아직 확인하지 않았습니다.');
  table('lo-held',['파일','이유','종류'],(d.held||[]).map((h)=>{const tr=el('tr');tr.append(loCell(h.rel.split('/').pop(),'incoming/'+h.rel),td(h.reason),td(LO_KIND[h.kind]||'-'));return tr;}),'임시 폴더가 비어 있습니다.',{tall:true});
  table('lo-recent',['파일','옮긴 곳','종류','옮긴 때'],(d.recent||[]).map((m)=>{const tr=el('tr');tr.append(loCell(m.to.split('/').pop(),'incoming/'+m.from),loCell(m.to,(LO_ROOT[m.root]||'')+(m.folderIsNew?'새 폴더':'')),td(LO_KIND[m.kind]||(m.root==='retro'?'레트로 롬':m.root==='homebrew'?'홈브류':'-')),td(new Date(m.at).toLocaleString()));return tr;}),'아직 옮긴 파일이 없습니다.');
  if(d.running||d.waiting)loTimer=setTimeout(loLoad,5000);}
async function loLoad(){try{loRender(await api('/admin/api/library/organize'));}catch(err){toast(err.message);}}
$('lo-sweep').addEventListener('click',async()=>{$('lo-sweep').disabled=true;
  try{const d=await api('/admin/api/library/organize/sweep',{method:'POST',body:{}});toast(d.moved?num(d.moved)+'개 옮겼습니다':'옮길 파일이 없습니다');loRender(d);}
  catch(err){toast(err.message);loLoad();}});
`;
