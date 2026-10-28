import { CONTENT_EDITOR_SCRIPT } from "./content-editor.js";
/**
 * The library tab's game patches and saves: grouped by game (the base title
 * id ties each to its game), patches searchable and switched between required
 * and optional with one press, and both edited, moved to another game or
 * deleted from one dialog. The game editor below lists the same rows for the
 * game it has open. Talks to /admin/api/patches, /admin/api/saves and
 * /admin/api/content. The homebrew tab opens the same dialog for a homebrew
 * app's patch, with only its text (no update to pick, no move or delete).
 * A patch's text is kept on the server, not in a patch.json in its folder; the
 * edit dialog offers a folder's patch.json when it says something else.
 * Each row has the homebrew tab's 검수됨 pill (POST /admin/api/content/:kind/verified).
 */
import { top, topPh } from "./top-i18n.js";

export const PATCHES_HTML = `<h2 class="first">${top("m.patches")}</h2>
  <p class="muted" data-top="pt.intro">${top("pt.intro")}</p>
  <div class="pt-tools">
    <input id="pt-q" type="search" autocomplete="off" spellcheck="false" placeholder="게임 이름, 타이틀 ID, 패치 이름" aria-label="패치 찾기">
    <button type="button" id="pt-only" aria-pressed="false">필수만 보기</button>
    <button type="button" class="primary" id="pt-upload" data-top="pt.upload">${top("pt.upload")}</button>
  </div>
  <p class="muted" id="pt-count"></p>
  <div id="lib-patches" data-skel></div>`;

export const SAVES_HTML = `  <h2 class="first">${top("m.saves")}</h2>
  <p class="muted" data-top="sv.intro">${top("sv.intro")}</p>
  <div id="lib-saves" data-skel></div>`;

export const GAME_PATCHES_HTML = `<h3>이 게임의 패치와 세이브</h3>
      <div id="gd-patches"></div>`;

export const CONTENT_DIALOG_HTML = `<dialog id="ct-edit" aria-labelledby="ct-title">
  <h3 id="ct-title"></h3>
  <p class="muted" id="ct-where"></p>
  <div class="note" id="ct-json" hidden><span id="ct-json-msg"></span> <button type="button" id="ct-json-go">patch.json 에서 가져오기</button></div>
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
    <label data-game>${top("gp.move")}<span class="ct-move"><input id="ct-move" autocomplete="off" ${topPh("gp.ph")}><button type="button" id="ct-move-go">${top("gp.moveGo")}</button></span></label>
    <div class="dialog-actions">
      <button type="button" class="danger" id="ct-remove" data-game data-top="pp.delete">${top("pp.delete")}</button>
      <button type="button" id="ct-close" data-top="acc.close">${top("acc.close")}</button>
      <button type="submit" class="primary" data-top="fp.save">${top("fp.save")}</button>
    </div>
  </form>
</dialog>`;

export const PATCHES_CSS = `
.pt-tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}.pt-tools input{flex:1 1 240px;min-width:0}
.pt-tools button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pt-game{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:6px 14px;margin:0 0 10px}
.pt-game>header{display:flex;align-items:center;justify-content:flex-start;gap:12px;padding:10px 0 6px;text-align:left}
.pt-game>header>div{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;flex:1}
.pt-game>header b{max-width:100%;font-size:var(--fs-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pt-game>header span{font-size:var(--fs-xs);color:var(--muted);font-family:ui-monospace,monospace}
.pt-ico{width:44px;height:44px;border-radius:var(--r-md);background:var(--sunk);object-fit:cover;flex:none}
.pt-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.pt-row:first-of-type{border-top:0}
.pt-row .pt-name{flex:1;min-width:0;overflow-wrap:anywhere}.pt-row .pt-name small{display:block;color:var(--muted);font-size:var(--fs-xs)}
.pt-row .pt-size{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
.pt-req{height:34px;min-width:92px;padding:0 10px 0 12px;gap:8px;justify-content:space-between;color:var(--muted)}
.pt-req[aria-checked="true"]{color:var(--text)}
.pt-req:disabled{opacity:.6;cursor:progress}
.pt-edit{width:34px;height:34px;padding:0;position:relative}.pt-edit>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#gd-patches .pt-row{border-top:1px solid var(--line)}#gd-patches .pt-row:first-child{border-top:0}
.ct-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ct-pair[hidden],.ct-note[hidden],#ct-form label[hidden],#ct-form button[hidden]{display:none}.ct-note{margin:0;font-size:var(--fs-xs)}
.pt-row .pt-name small.pt-miss{color:var(--warn)}
.ct-move{display:flex;gap:8px;margin-top:4px}.ct-move input{flex:1;min-width:0}
#ct-edit{width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box}
#ct-form label,#ct-form .ct-pair>*{min-width:0}#ct-form input,#ct-form select,#ct-form textarea{width:100%;min-width:0;box-sizing:border-box}
.ct-move input{width:auto}.ct-move button{flex:none}
@media (max-width:640px){.ct-pair{grid-template-columns:1fr}.pt-row{flex-wrap:wrap;row-gap:6px}.pt-row .pt-name{flex:1 1 100%}.pt-row .pt-size{margin-right:auto}}
`;

export const PATCHES_SCRIPT = /* js */ `
let ptData=[],svData=[];
const SAVE_TYPE_LABEL={device:'기기 공용',account:'계정별'};
const ptUpdate=(p)=>'v'+p.update_version+(p.game_version?' ('+p.game_version+')':'');
function ptRow(p){const r=el('div',null,'pt-row');const n=el('span',null,'pt-name');n.append(p.name);
  if(p.ko&&p.ko.name&&p.ko.name!==p.name)n.append(el('small',p.ko.name));
  if(p.update_version)n.append(p.update_in_library?el('small',ptUpdate(p)+' 용 패치입니다'):el('small',ptUpdate(p)+' 용 패치인데, 그 업데이트가 라이브러리에 없습니다','pt-miss'));
  r.append(n,el('span',mb(p.size),'pt-size'));
  // The words the library and the console show: 필수 when the game needs it, 비필수 otherwise.
  const b=el('button',p.required?'필수':'비필수','pt-req');b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(p.required));
  b.append(el('span',null,'switch'));b.setAttribute('aria-label',p.name+' 필수');
  b.title=p.required?'게임에 필수 패치로 나옵니다. 누르면 끕니다':'누르면 게임에 필수 패치로 나옵니다';
  b.addEventListener('click',()=>ptToggle(p,b));
  const e=btn('편집',()=>ctOpen('patch',p,loadPatches),'pt-edit');e.setAttribute('aria-label',p.name+' 편집');
  r.append(ctVerify('patch',p),b,e);return r;}
function svRow(s){const r=el('div',null,'pt-row');const n=el('span',null,'pt-name');n.append(s.name);
  const sub=[s.ko&&s.ko.name&&s.ko.name!==s.name?s.ko.name:'',SAVE_TYPE_LABEL[s.saveType]||''].filter(Boolean).join(' · ');if(sub)n.append(el('small',sub));
  const e=btn('편집',()=>ctOpen('save',s,loadPatches),'pt-edit');e.setAttribute('aria-label',s.name+' 편집');
  r.append(n,el('span',mb(s.size),'pt-size'),ctVerify('save',s),e);return r;}
// The 검수됨 pill, as on the homebrew tab: one press puts the library's badge on or takes it off.
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
    const g=el('section',null,'pt-game'),h=el('header'),tid=tidOf(items[0]),name=el('div');
    name.append(el('b',items[0].game||'titledb 에 없는 게임'),el('span',tid));
    // The game's own icon in front, like the console's list; an empty tile when the server has none.
    const ico=el('img',null,'pt-ico');ico.alt='';ico.loading='lazy';
    if(/^[0-9A-F]{16}$/i.test(tid)){ico.src='/api/library/icon/'+tid+'?size=sm';ico.onerror=()=>ico.removeAttribute('src');}
    h.append(ico,name);g.append(h,...items.map(row));return g;});}
function ptRender(){if(!$('lib-patches'))return;const q=$('pt-q').value.trim().toLowerCase(),only=$('pt-only').getAttribute('aria-pressed')==='true';
  const hit=(p)=>(!only||p.required)&&(!q||[p.game,p.title_id,p.name,p.ko&&p.ko.name].some((s)=>(s||'').toLowerCase().includes(q)));
  const req=ptData.filter((p)=>p.required).length,miss=ptData.filter((p)=>p.update_version&&!p.update_in_library).length;
  $('pt-count').textContent=ptData.length?'게임 '+new Set(ptData.map((p)=>p.title_id)).size+'개에 패치 '+ptData.length+'개가 있고, 그중 필수는 '+req+'개입니다.'
    +(miss?' 맞는 업데이트가 라이브러리에 없는 패치가 '+miss+'개 있습니다.':''):'';
  const m=$('lib-patches');
  if(!ptData.length){m.replaceChildren(el('div','게임 패치가 없습니다. 업로드 탭에서 올립니다.','empty'));return;}
  const groups=ctGroups(ptData.filter(hit),(p)=>p.title_id,ptRow);
  m.replaceChildren(...(groups.length?groups:[el('div','찾는 패치가 없습니다.','empty')]));}
function svRender(){const m=$('lib-saves');if(!m)return;
  m.replaceChildren(...(svData.length?ctGroups(svData,(s)=>s.titleId,svRow):[el('div','게임 세이브가 없습니다. 업로드 탭에서 올립니다.','empty')]));}
// The game editor's own list, for the game it has open (gdId).
function ptGame(){const m=$('gd-patches');if(!m)return;
  const rows=[...ptData.filter((p)=>p.title_id===gdId).map(ptRow),...svData.filter((s)=>s.titleId===gdId).map(svRow)];
  m.replaceChildren(...(rows.length?rows:[el('div','이 게임에 엮인 패치와 세이브가 없습니다. 폴더 이름이 이 게임의 타이틀 ID 여야 합니다.','empty')]));}
async function loadPatches(){let p,s;try{[p,s]=await Promise.all([api('/admin/api/patches'),api('/admin/api/saves')]);}catch(err){toast(err.message);return;}
  ptData=p.patches||[];svData=s.saves||[];ptRender();svRender();ptGame();}
$('pt-q')?.addEventListener('input',ptRender);
$('pt-upload')?.addEventListener('click',()=>{location.href='/admin/upload?kind=patch';});
$('pt-only')?.addEventListener('click',(e)=>{const b=e.currentTarget;b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));ptRender();});

${CONTENT_EDITOR_SCRIPT}
`;
