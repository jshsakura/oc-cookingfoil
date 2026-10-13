/**
 * The library tab's game patches: grouped by game (the base title id ties a
 * patch to its game), searchable, and each one switched between required and
 * optional with one press. The game editor below shows the same switches for
 * the game it has open. Talks to /admin/api/patches.
 */

export const PATCHES_HTML = `<h2>게임 패치</h2>
  <p class="muted">패치는 타이틀 ID 로 게임에 엮입니다. 필수를 누르면 이 패치 없이는 게임이 실행되지 않는다고 표시하고, 한 번 더 누르면 선택으로 돌아갑니다. 기기는 필수 패치를 게임 상세에서 함께 설치할 것으로 보여 줍니다.</p>
  <div class="pt-tools">
    <input id="pt-q" type="search" autocomplete="off" spellcheck="false" placeholder="게임 이름, 타이틀 ID, 패치 이름" aria-label="패치 찾기">
    <button type="button" id="pt-only" aria-pressed="false">필수만 보기</button>
  </div>
  <p class="muted" id="pt-count"></p>
  <div id="lib-patches"></div>`;

export const GAME_PATCHES_HTML = `<h3>이 게임의 패치</h3>
      <div id="gd-patches"></div>`;

export const PATCHES_CSS = `
.pt-tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}.pt-tools input{flex:1 1 240px;min-width:0}
.pt-tools button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pt-game{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:6px 14px;margin:0 0 10px}
.pt-game>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:8px 0 4px}
.pt-game>header b{font-size:15px}.pt-game>header span{font-size:12.5px;color:var(--muted);font-family:ui-monospace,monospace}
.pt-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.pt-row:first-of-type{border-top:0}
.pt-row .pt-name{flex:1;min-width:0;overflow-wrap:anywhere}.pt-row .pt-size{font-size:12.5px;color:var(--muted);white-space:nowrap}
.pt-req{min-width:64px;padding:5px 12px;border-radius:100px;font-size:13px;font-weight:700;background:var(--sunk);color:var(--muted);border:1px solid var(--line);cursor:pointer}
.pt-req[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.pt-req:disabled{opacity:.6;cursor:progress}
#gd-patches .pt-row{border-top:1px solid var(--line)}#gd-patches .pt-row:first-child{border-top:0}
`;

export const PATCHES_SCRIPT = /* js */ `
let ptData=[];
function ptRow(p){const r=el('div',null,'pt-row');
  const b=el('button',p.required?'필수':'선택','pt-req');b.type='button';b.setAttribute('aria-pressed',String(p.required));
  b.setAttribute('aria-label',p.name+' 필수');b.title=p.required?'누르면 선택으로 바꿉니다':'누르면 필수로 바꿉니다';
  b.addEventListener('click',()=>ptToggle(p,b));
  r.append(el('span',p.name,'pt-name'),el('span',mb(p.size),'pt-size'),b);return r;}
async function ptToggle(p,b){const next=!p.required;b.disabled=true;
  try{await api('/admin/api/patches/required',{method:'POST',body:{id:p.id,required:next}});
    ptData=ptData.map((x)=>x.id===p.id?{...x,required:next}:x);toast(next?'필수로 표시했습니다':'선택으로 바꿨습니다');ptRender();ptGame();}
  catch(err){toast(err.message);b.disabled=false;}}
function ptRender(){const q=$('pt-q').value.trim().toLowerCase(),only=$('pt-only').getAttribute('aria-pressed')==='true';
  const hit=(p)=>(!only||p.required)&&(!q||[p.game,p.title_id,p.name].some((s)=>(s||'').toLowerCase().includes(q)));
  const groups=new Map();for(const p of ptData.filter(hit)){if(!groups.has(p.title_id))groups.set(p.title_id,[]);groups.get(p.title_id).push(p);}
  const sorted=[...groups.values()].sort((a,b)=>(a[0].game||a[0].title_id).localeCompare(b[0].game||b[0].title_id));
  const req=ptData.filter((p)=>p.required).length;
  $('pt-count').textContent=ptData.length?'게임 '+new Set(ptData.map((p)=>p.title_id)).size+'개에 패치 '+ptData.length+'개가 있고, 그중 필수는 '+req+'개입니다.':'';
  const m=$('lib-patches');
  if(!ptData.length){m.replaceChildren(el('div','게임 패치가 없습니다. 업로드 탭에서 올립니다.','empty'));return;}
  if(!sorted.length){m.replaceChildren(el('div','찾는 패치가 없습니다.','empty'));return;}
  m.replaceChildren(...sorted.map((list)=>{const g=el('section',null,'pt-game');const h=el('header');
    h.append(el('b',list[0].game||'이름 모르는 게임'),el('span',list[0].title_id));g.append(h,...list.map(ptRow));return g;}));}
// The game editor's own list, for the game it has open (gdId).
function ptGame(){const m=$('gd-patches');if(!m)return;const list=ptData.filter((p)=>p.title_id===gdId);
  m.replaceChildren(...(list.length?list.map(ptRow):[el('div','이 게임에 엮인 패치가 없습니다. 패치 폴더 이름이 이 게임의 타이틀 ID 여야 합니다.','empty')]));}
async function loadPatches(){let d;try{d=await api('/admin/api/patches');}catch(err){toast(err.message);return;}
  ptData=d.patches||[];ptRender();ptGame();}
$('pt-q').addEventListener('input',ptRender);
$('pt-only').addEventListener('click',(e)=>{const b=e.currentTarget;b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));ptRender();});
`;
