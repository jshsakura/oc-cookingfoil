/**
 * The library tab's game patches and saves: grouped by game (the base title
 * id ties each to its game), patches searchable and switched between required
 * and optional with one press, and both edited, moved to another game or
 * deleted from one dialog. The game editor below lists the same rows for the
 * game it has open. Talks to /admin/api/patches, /admin/api/saves and
 * /admin/api/content. The homebrew tab opens the same dialog for a homebrew
 * app's patch, with only its text (no update to pick, no move or delete).
 * A patch's text is kept on the server, not in a patch.json in its folder.
 * Each row has the homebrew tab's 검수됨 pill (POST /admin/api/content/:kind/verified).
 */

export const PATCHES_HTML = `<h2 class="first">게임 패치</h2>
  <p class="muted">패치는 타이틀 ID 로 게임에 엮입니다. 필수를 누르면 이 패치 없이는 게임이 실행되지 않는다고 표시하고, 한 번 더 누르면 선택으로 돌아갑니다. 기기는 필수 패치를 게임 상세에서 함께 설치할 것으로 보여 줍니다. 편집에서 이름과 설명을 고치고, 다른 게임으로 옮기거나 삭제합니다. 패치 정보는 서버에 저장합니다. 폴더에 patch.json 이 있으면 처음 볼 때 한 번만 가져오고, 그 뒤로 파일을 고쳐도 반영하지 않으니 여기서 고칩니다. 기기에서 돌려 봤으면 검수 전을 눌러 상점에 검수됨 배지를 붙입니다.</p>
  <div class="pt-tools">
    <input id="pt-q" type="search" autocomplete="off" spellcheck="false" placeholder="게임 이름, 타이틀 ID, 패치 이름" aria-label="패치 찾기">
    <button type="button" id="pt-only" aria-pressed="false">필수만 보기</button>
  </div>
  <p class="muted" id="pt-count"></p>
  <div id="lib-patches"></div>`;

export const SAVES_HTML = `  <h2 class="first">게임 세이브</h2>
  <p class="muted">기기가 게임 상세에서 받아 넣는 세이브입니다. 편집에서 이름, 설명, 세이브 종류, 출처를 고치고, 다른 게임으로 옮기거나 삭제합니다. 기기에서 넣어 봤으면 검수 전을 눌러 상점에 검수됨 배지를 붙입니다.</p>
  <div id="lib-saves"></div>`;

export const GAME_PATCHES_HTML = `<h3>이 게임의 패치와 세이브</h3>
      <div id="gd-patches"></div>`;

export const CONTENT_DIALOG_HTML = `<dialog id="ct-edit" aria-labelledby="ct-title">
  <h3 id="ct-title"></h3>
  <p class="muted" id="ct-where"></p>
  <form class="desc-form" id="ct-form" method="dialog" autocomplete="off">
    <label>이름 (모든 언어의 기본값)<input id="ct-name" maxlength="120" required></label>
    <label>한국어 이름 (다를 때만)<input id="ct-name-ko" maxlength="120"></label>
    <label>설명 (모든 언어의 기본값)<textarea id="ct-desc" maxlength="2000"></textarea></label>
    <label>한국어 설명 (다를 때만)<textarea id="ct-desc-ko" maxlength="2000"></textarea></label>
    <div class="ct-pair" data-for="patch"><label>버전<input id="ct-version" maxlength="40"></label><label>만든 사람<input id="ct-author" maxlength="120"></label></div>
    <div class="ct-pair" data-for="patch" data-game><label>필요한 업데이트<select id="ct-update"><option value="">정하지 않습니다</option></select></label>
      <label>게임 버전<input id="ct-p-game-version" maxlength="40" placeholder="1.0.32.0"></label></div>
    <p class="muted ct-note" data-for="patch" data-game>이 패치가 만들어진 업데이트를 적어 두는 참고 정보입니다. 업데이트를 숨기거나 막지 않습니다.</p>
    <div class="ct-pair" data-for="save"><label>게임 버전<input id="ct-game-version" maxlength="40"></label>
      <label>세이브 종류<select id="ct-save-type"><option value="">가리지 않습니다</option><option value="device">기기 공용 세이브</option><option value="account">계정별 세이브</option></select></label></div>
    <div class="ct-pair" data-for="save"><label>출처 이름<input id="ct-source-name" maxlength="120"></label><label>출처 주소<input id="ct-source-url" maxlength="300" placeholder="https://"></label></div>
    <label data-game>다른 게임으로 옮기기<span class="ct-move"><input id="ct-move" list="gd-games" placeholder="게임 이름이나 16자리 타이틀 ID"><button type="button" id="ct-move-go">옮기기</button></span></label>
    <div class="dialog-actions">
      <button type="button" class="danger" id="ct-remove" data-game>삭제</button>
      <button type="button" id="ct-close">닫기</button>
      <button type="submit" class="primary">저장</button>
    </div>
  </form>
</dialog>`;

export const PATCHES_CSS = `
.pt-tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}.pt-tools input{flex:1 1 240px;min-width:0}
.pt-tools button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pt-game{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:6px 14px;margin:0 0 10px}
.pt-game>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:8px 0 4px}
.pt-game>header b{font-size:15px}.pt-game>header span{font-size:12.5px;color:var(--muted);font-family:ui-monospace,monospace}
.pt-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.pt-row:first-of-type{border-top:0}
.pt-row .pt-name{flex:1;min-width:0;overflow-wrap:anywhere}.pt-row .pt-name small{display:block;color:var(--muted);font-size:12px}
.pt-row .pt-size{font-size:12.5px;color:var(--muted);white-space:nowrap}
.pt-req{height:34px;min-width:92px;padding:0 10px 0 12px;gap:8px;justify-content:space-between;color:var(--muted)}
.pt-req .switch{position:relative;flex:none;width:30px;height:18px;border-radius:100px;background:var(--line);transition:background .15s}
.pt-req .switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.pt-req[aria-checked="true"]{color:var(--text);border-color:var(--accent)}
.pt-req[aria-checked="true"] .switch{background:var(--accent)}
.pt-req[aria-checked="true"] .switch::after{transform:translateX(12px)}
.pt-req:disabled{opacity:.6;cursor:progress}
@media (prefers-reduced-motion:reduce){.pt-req .switch,.pt-req .switch::after{transition:none}}
.pt-edit{width:34px;height:34px;padding:0;position:relative}.pt-edit>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#gd-patches .pt-row{border-top:1px solid var(--line)}#gd-patches .pt-row:first-child{border-top:0}
.ct-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ct-pair[hidden],.ct-note[hidden],#ct-form label[hidden],#ct-form button[hidden]{display:none}.ct-note{margin:0;font-size:12.5px}
.pt-row .pt-name small.pt-miss{color:var(--warn)}
.ct-move{display:flex;gap:8px;margin-top:4px}.ct-move input{flex:1;min-width:0}
#ct-edit{width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box}
#ct-form label,#ct-form .ct-pair>*{min-width:0}#ct-form input,#ct-form select,#ct-form textarea{width:100%;min-width:0;box-sizing:border-box}
.ct-move input{width:auto}.ct-move button{flex:none}
@media (max-width:640px){.ct-pair{grid-template-columns:1fr}}
`;

export const PATCHES_SCRIPT = /* js */ `
let ptData=[],svData=[];
const SAVE_TYPE_LABEL={device:'기기 공용',account:'계정별'};
const ptUpdate=(p)=>'v'+p.update_version+(p.game_version?' ('+p.game_version+')':'');
function ptRow(p){const r=el('div',null,'pt-row');const n=el('span',null,'pt-name');n.append(p.name);
  if(p.ko&&p.ko.name&&p.ko.name!==p.name)n.append(el('small',p.ko.name));
  if(p.update_version)n.append(p.update_in_library?el('small',ptUpdate(p)+' 용 패치입니다'):el('small',ptUpdate(p)+' 용 패치인데, 그 업데이트가 라이브러리에 없습니다','pt-miss'));
  r.append(n,el('span',mb(p.size),'pt-size'));
  // The words the shop and the console show: 필수 when the game needs it, 비필수 otherwise.
  const b=el('button',p.required?'필수':'비필수','pt-req');b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(p.required));
  b.append(el('span',null,'switch'));b.setAttribute('aria-label',p.name+' 필수');
  b.title=p.required?'게임에 필수 패치로 나옵니다. 누르면 끕니다':'누르면 게임에 필수 패치로 나옵니다';
  b.addEventListener('click',()=>ptToggle(p,b));
  const e=btn('편집',()=>ctOpen('patch',p),'pt-edit');e.setAttribute('aria-label',p.name+' 편집');
  r.append(ctVerify('patch',p),b,e);return r;}
function svRow(s){const r=el('div',null,'pt-row');const n=el('span',null,'pt-name');n.append(s.name);
  const sub=[s.ko&&s.ko.name&&s.ko.name!==s.name?s.ko.name:'',SAVE_TYPE_LABEL[s.saveType]||''].filter(Boolean).join(' · ');if(sub)n.append(el('small',sub));
  const e=btn('편집',()=>ctOpen('save',s),'pt-edit');e.setAttribute('aria-label',s.name+' 편집');
  r.append(n,el('span',mb(s.size),'pt-size'),ctVerify('save',s),e);return r;}
// The 검수됨 pill, as on the homebrew tab: one press puts the shop's badge on or takes it off.
function ctVerify(kind,x){return verifyPill(x.name,x.verified,async(next)=>{
  try{await api('/admin/api/content/'+kind+'/verified',{method:'POST',body:{id:x.id,verified:next}});
    const mark=(list)=>list.map((y)=>y.id===x.id?{...y,verified:next}:y);
    if(kind==='patch')ptData=mark(ptData);else svData=mark(svData);
    toast(next?x.name+' 에 검수됨 배지를 붙였습니다.':x.name+' 의 검수됨 배지를 뗐습니다.');}
  catch(err){toast(err.message);}
  ptRender();svRender();ptGame();});}
async function ptToggle(p,b){const next=!p.required;b.disabled=true;
  try{await api('/admin/api/patches/required',{method:'POST',body:{id:p.id,required:next}});
    ptData=ptData.map((x)=>x.id===p.id?{...x,required:next}:x);toast(next?'필수로 변경했습니다':'비필수로 변경했습니다');ptRender();ptGame();}
  catch(err){toast(err.message);b.disabled=false;}}
function ctGroups(list,tidOf,row){const groups=new Map();for(const x of list){const t=tidOf(x);if(!groups.has(t))groups.set(t,[]);groups.get(t).push(x);}
  return [...groups.values()].sort((a,b)=>(a[0].game||tidOf(a[0])).localeCompare(b[0].game||tidOf(b[0]))).map((items)=>{
    const g=el('section',null,'pt-game');const h=el('header');h.append(el('b',items[0].game||'titledb 에 없는 게임'),el('span',tidOf(items[0])));g.append(h,...items.map(row));return g;});}
function ptRender(){const q=$('pt-q').value.trim().toLowerCase(),only=$('pt-only').getAttribute('aria-pressed')==='true';
  const hit=(p)=>(!only||p.required)&&(!q||[p.game,p.title_id,p.name,p.ko&&p.ko.name].some((s)=>(s||'').toLowerCase().includes(q)));
  const req=ptData.filter((p)=>p.required).length,miss=ptData.filter((p)=>p.update_version&&!p.update_in_library).length;
  $('pt-count').textContent=ptData.length?'게임 '+new Set(ptData.map((p)=>p.title_id)).size+'개에 패치 '+ptData.length+'개가 있고, 그중 필수는 '+req+'개입니다.'
    +(miss?' 맞는 업데이트가 라이브러리에 없는 패치가 '+miss+'개 있습니다.':''):'';
  const m=$('lib-patches');
  if(!ptData.length){m.replaceChildren(el('div','게임 패치가 없습니다. 업로드 탭에서 올립니다.','empty'));return;}
  const groups=ctGroups(ptData.filter(hit),(p)=>p.title_id,ptRow);
  m.replaceChildren(...(groups.length?groups:[el('div','찾는 패치가 없습니다.','empty')]));}
function svRender(){const m=$('lib-saves');
  m.replaceChildren(...(svData.length?ctGroups(svData,(s)=>s.titleId,svRow):[el('div','게임 세이브가 없습니다. 업로드 탭에서 올립니다.','empty')]));}
// The game editor's own list, for the game it has open (gdId).
function ptGame(){const m=$('gd-patches');if(!m)return;
  const rows=[...ptData.filter((p)=>p.title_id===gdId).map(ptRow),...svData.filter((s)=>s.titleId===gdId).map(svRow)];
  m.replaceChildren(...(rows.length?rows:[el('div','이 게임에 엮인 패치와 세이브가 없습니다. 폴더 이름이 이 게임의 타이틀 ID 여야 합니다.','empty')]));}
async function loadPatches(){let p,s;try{[p,s]=await Promise.all([api('/admin/api/patches'),api('/admin/api/saves')]);}catch(err){toast(err.message);return;}
  ptData=p.patches||[];svData=s.saves||[];ptRender();svRender();ptGame();}
$('pt-q').addEventListener('input',ptRender);
$('pt-only').addEventListener('click',(e)=>{const b=e.currentTarget;b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));ptRender();});

// One dialog edits a patch or a save: its text, its game, or deletes it.
// A homebrew app's patch (x.homebrew) gets its text only; onDone reloads the tab that opened it.
let ctItem=null,ctKind='',ctAfter=null;
function ctOpen(kind,x,onDone){ctKind=kind;ctItem=x;ctAfter=onDone||null;const hb=Boolean(x.homebrew);
  const tid=hb?'switch/'+x.homebrew+'/':kind==='patch'?x.title_id:x.titleId;
  $('ct-title').textContent=(kind==='patch'?'패치 편집: ':'세이브 편집: ')+x.name;
  $('ct-where').textContent=(x.game?x.game+' · ':'')+tid+' · 파일 '+x.files+'개, '+mb(x.size);
  for(const d of document.querySelectorAll('#ct-form [data-for]'))d.hidden=d.dataset.for!==kind;
  for(const d of document.querySelectorAll('#ct-form [data-game]'))if(hb)d.hidden=true;else if(!d.dataset.for||d.dataset.for===kind)d.hidden=false;
  $('ct-name').value=x.name||'';$('ct-name-ko').value=x.ko?.name||'';$('ct-desc').value=x.description||'';$('ct-desc-ko').value=x.ko?.description||'';
  $('ct-version').value=x.version||'';$('ct-author').value=x.author||'';$('ct-game-version').value=x.gameVersion||'';$('ct-save-type').value=x.saveType||'';
  $('ct-source-name').value=x.source?.name||'';$('ct-source-url').value=x.source?.url||'';$('ct-move').value='';
  $('ct-p-game-version').value=x.game_version||'';
  if(kind==='patch'&&!hb)ctUpdates(x);
  $('ct-edit').showModal();}
// The updates titledb lists for the game and the ones in the library; the patch's own stays selectable.
let ctChoices=[];
async function ctUpdates(x){const s=$('ct-update');const keep=(list)=>{
  const opts=[el('option','정하지 않습니다')];opts[0].value='';
  const has=new Set(list.map((u)=>u.version));
  const all=x.update_version&&!has.has(x.update_version)?[{version:x.update_version,date:null,display:x.game_version||null,in_library:Boolean(x.update_in_library)},...list]:list;
  for(const u of all){const o=el('option',['v'+u.version,u.display,u.date,u.in_library?'라이브러리에 있음':''].filter(Boolean).join(' · '));o.value=String(u.version);opts.push(o);}
  s.replaceChildren(...opts);s.value=x.update_version?String(x.update_version):'';};
  keep([]);ctChoices=[];
  try{const r=await api('/admin/api/patches/updates?titleId='+encodeURIComponent(x.title_id));if(ctItem!==x)return;ctChoices=r.updates||[];keep(ctChoices);}
  catch(err){toast(err.message);}}
$('ct-update').addEventListener('change',()=>{const u=ctChoices.find((c)=>String(c.version)===$('ct-update').value);
  if(u&&u.display&&!$('ct-p-game-version').value)$('ct-p-game-version').value=u.display;});
const ctDone=(msg)=>{$('ct-edit').close();toast(msg);if(ctAfter)ctAfter();else loadPatches();};
$('ct-close').addEventListener('click',()=>$('ct-edit').close());
$('ct-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const body={id:ctItem.id,name:$('ct-name').value,nameKo:$('ct-name-ko').value,description:$('ct-desc').value,descriptionKo:$('ct-desc-ko').value,
    version:$('ct-version').value,author:$('ct-author').value,gameVersion:$(ctKind==='patch'?'ct-p-game-version':'ct-game-version').value,saveType:$('ct-save-type').value,
    ...(ctKind==='patch'&&!ctItem.homebrew?{updateVersion:$('ct-update').value}:{}),
    sourceName:$('ct-source-name').value,sourceUrl:$('ct-source-url').value};
  try{await api('/admin/api/content/'+ctKind+'/meta',{method:'POST',body});ctDone('저장했습니다.');}catch(err){toast(err.message);}});
$('ct-move-go').addEventListener('click',async()=>{const m=$('ct-move').value.match(/[0-9A-Fa-f]{16}/);
  if(!m){toast('옮길 게임을 고릅니다.');return;}const to=m[0].toUpperCase();
  if(!await ask(ctItem.name+' 을(를) '+to+' 게임으로 옮깁니다.'+(ctKind==='patch'?' 패치 안의 게임 폴더 이름도 함께 바뀝니다.':'')))return;
  try{await api('/admin/api/content/'+ctKind+'/move',{method:'POST',body:{id:ctItem.id,titleId:to}});ctDone('옮겼습니다.');}catch(err){toast(err.message);}});
$('ct-remove').addEventListener('click',async()=>{if(!await ask(ctItem.name+' 을(를) 서버에서 삭제합니다. 되돌릴 수 없습니다.'))return;
  try{await api('/admin/api/content/'+ctKind+'/remove',{method:'POST',body:{id:ctItem.id}});ctDone('삭제했습니다.');}catch(err){toast(err.message);}});
`;
