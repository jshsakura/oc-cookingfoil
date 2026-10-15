/**
 * The retro tab's versions block: files that are one game (a patch beside an
 * official release, an arcade parent and its clones), the file each group
 * shows, arcade sets that can't run, and the trash. Talks to
 * /admin/api/retro-variants.
 */

export const RETRO_VARIANTS_HTML = `
  <div class="hd"><h2 class="first" id="rv-title">같은 게임의 여러 버전</h2></div>
  <p class="muted" id="rv-help"></p>
  <div class="row-actions" id="rv-tools"><input id="rv-filter" placeholder="이름으로 찾기" aria-label="이름으로 찾기"><label id="rv-broken-wrap" hidden><input type="checkbox" id="rv-broken"> 못 도는 세트만</label></div>
  <p class="muted" id="rv-summary"></p>
  <div class="scroll" id="rv-list"></div>`;

export const RETRO_VARIANTS_CSS = `
#rv-list tr.rv-head td{background:var(--sunk);font-weight:700}
#rv-list tr.rv-head .muted{font-weight:500;margin-left:8px}
#rv-list .pill{margin:0 4px 2px 0}
#rv-list .pill.warn{background:rgba(217,164,0,.16);color:var(--text)}
#rv-filter{max-width:220px}
#rv-list .rv-nw{white-space:nowrap}
#rv-tools{display:flex;gap:12px;align-items:center;margin:6px 0}
`;

export const RETRO_VARIANTS_SCRIPT = /* js */ `
let rvView='dups',rvData={},rvSeq=0;
const RV_HELP={
  dups:'같은 시스템에서 제목이 같은 파일을 묶었습니다. 목록에는 묶음마다 추천 버전 하나만 나오고 나머지 버전은 게임 창에서 고릅니다. 추천 버전은 공식 한국어판, 가장 새 한글 패치 순으로 정하고 여기서 바꿀 수 있습니다. 휴지통으로 옮기면 롬과 표지, 베젤 파일이 레트로 폴더의 .trash 로 갑니다.',
  sets:'아케이드는 FinalBurn Neo 의 부모 세트와 클론 세트를 한 게임으로 봅니다. 한국판, 해외판, 북미판, 유럽판, 일본판 순으로 돌아가는 정규 세트를 추천 버전으로 정합니다. 부모 롬이나 BIOS 가 roms/arcade 에 없으면 그 세트는 실행되지 않습니다.',
  trash:'휴지통으로 옮긴 파일입니다. 지우지 않고 보관하며, 되돌리면 원래 자리로 돌아갑니다.'};
const RV_TAGS={bootleg:'부트렉',hack:'해킹',prototype:'시제품',demo:'데모',decrypted:'복호화판','cps-changer':'CPS 체인저','4p':'4인용','3p':'3인용',resale:'재판',mvs:'MVS',aes:'AES'};
const RV_REGION={kr:'한국',world:'세계',us:'미국',eu:'유럽',jp:'일본',asia:'아시아',hisp:'중남미',br:'브라질'};
const RV_HIDDEN={missing:'실행 불가',bootleg:'부트렉',hack:'해킹',prototype:'시제품',demo:'데모'};
const rvMb=(n)=>n==null?'—':n<1048576?Math.max(1,Math.round(n/1024))+' KB':(n/1048576).toFixed(1)+' MB';
const rvDate=(s)=>s?new Date(s*1000).toLocaleDateString('ko-KR'):'—';
function rvEdition(m){const e=m.edition;if(!e)return m.region?RV_REGION[m.region]||m.region:'—';
  return (e.source==='official'?'공식 한국어판':'한글 패치')+(e.version?' '+e.version:'');}
function rvTags(m){const box=el('div');
  if(m.representative)box.append(pill('추천','on'));
  if(m.class){if(m.class.region)box.append(pill(RV_REGION[m.class.region]||m.class.region));
    if(m.class.date)box.append(pill(String(m.class.date).replace(/(\\d{4})(\\d{2})(\\d{2})/,'$1.$2.$3')));
    for(const t of [...m.class.flags,...m.class.hardware])box.append(pill(RV_TAGS[t]||t,['bootleg','hack','prototype','demo'].includes(t)?'warn':''));}
  if(m.hidden&&!m.representative)box.append(pill('목록에서 숨김: '+(RV_HIDDEN[m.hidden]||m.hidden),'off'));
  if(m.missing)box.append(pill('빠진 파일: '+m.missing.map((s)=>s+'.zip').join(', '),'off'));
  return box;}
function rvHead(text,sub,cols){const tr=el('tr','', 'rv-head');const c=el('td');c.colSpan=cols;c.append(text);if(sub)c.append(el('span',sub,'muted'));tr.append(c);return tr;}
function rvMemberRow(g,m,withSize){const tr=el('tr');
  const n=td();n.append(m.name);n.append(el('div',m.file,'muted'));
  const acts=el('div',null,'row-actions');
  const pick=btn(m.representative?'추천 버전입니다':'추천 버전으로 정합니다',()=>rvPick(g,m));pick.disabled=m.representative;
  const trash=btn('휴지통으로 옮깁니다',()=>rvTrash(m),'danger');
  acts.append(pick,trash);
  tr.append(n,td(m.variant||'—'),raCell(rvTags(m)),td(rvEdition(m)));
  if(withSize)tr.append(td(rvMb(m.size),'rv-nw'),td(rvDate(m.addedAt),'rv-nw'));
  tr.append(raCell(acts));return tr;}
function rvMatch(g,q){return !q||g.members.some((m)=>(m.name+' '+m.file).toLowerCase().includes(q));}
const RV_TITLE={dups:'같은 게임의 여러 버전',sets:'아케이드 세트',trash:'휴지통'};
function rvShow(){
  $('rv-title').textContent=RV_TITLE[rvView];
  $('rv-help').textContent=RV_HELP[rvView];$('rv-broken-wrap').hidden=rvView!=='sets';
  const q=$('rv-filter').value.trim().toLowerCase();
  if(rvView==='trash'){
    const items=(rvData.trash?.items||[]).filter((i)=>!q||(i.name+' '+i.file).toLowerCase().includes(q));
    $('rv-summary').textContent=items.length?'휴지통에 '+items.length+'개 있습니다.':'';
    table('rv-list',['이름','시스템','크기','옮긴 때',''],items.map((i)=>{const tr=el('tr');
      const n=td();n.append(i.name);n.append(el('div','파일 '+i.files.length+'개','muted'));
      tr.append(n,td(i.system),td(rvMb(i.size)),td(fmt(i.trashedAt)),raCell(btn('되돌립니다',()=>rvRestore(i))));return tr;}),'휴지통이 비어 있습니다.');
    return;}
  if(rvView==='sets'){
    const d=rvData.sets;if(!d){$('rv-list').replaceChildren();return;}
    const s=d.summary;const hid=Object.entries(s.hidden).map(([k,v])=>(RV_HIDDEN[k]||k)+' '+v).join(', ');
    $('rv-summary').textContent='게임 '+s.groups+'개, 세트 '+s.sets+'개입니다. 목록에 나오는 게임은 '+s.listed+'개이고, 실행되지 않는 세트는 '+s.broken+'개입니다.'+(hid?' 기본 목록에서 숨긴 세트: '+hid+'.':'');
    const only=$('rv-broken').checked;
    const groups=d.groups.filter((g)=>rvMatch(g,q)&&(!only||g.members.some((m)=>m.missing)));
    const rows=groups.flatMap((g)=>[rvHead(g.members[0].name,(g.listed?'':'목록에 나오지 않습니다. ')+g.reason,5),...g.members.map((m)=>rvMemberRow(g,m,false))]);
    table('rv-list',['이름','버전','태그','지역',''],rows,only?'못 도는 세트가 없습니다.':'아케이드 세트가 없습니다.');
    return;}
  const d=rvData.dups;if(!d){$('rv-list').replaceChildren();return;}
  const groups=d.groups.filter((g)=>rvMatch(g,q));
  $('rv-summary').textContent='묶음 '+d.groups.length+'개에 파일 '+d.groups.reduce((n,g)=>n+g.members.length,0)+'개가 있습니다.';
  const rows=groups.flatMap((g)=>[rvHead(g.systemName,g.reason,7),...g.members.map((m)=>rvMemberRow(g,m,true))]);
  table('rv-list',['이름','버전 정보','태그','종류','크기','추가한 날',''],rows,'같은 게임의 여러 버전이 없습니다.');
}
async function loadRetroVariants(){
  const n=++rvSeq;
  try{const url=rvView==='sets'?'/admin/api/retro-variants/sets':rvView==='trash'?'/admin/api/retro-variants/trash':'/admin/api/retro-variants';
    const d=await api(url);if(n!==rvSeq)return;rvData[rvView]=d;rvShow();}catch(err){toast(err.message);}
}
async function rvPick(g,m){
  try{await api('/admin/api/retro-variants/pick',{method:'POST',body:{group:g.id,game:m.id}});toast('추천 버전을 바꿨습니다.');loadRetroVariants();}catch(err){toast(err.message);}
}
async function rvTrash(m,force=false){
  if(!force&&!confirm(m.file+' 파일을 휴지통으로 옮깁니다. 롬과 표지, 베젤 파일이 레트로 폴더의 .trash 로 가고, 휴지통에서 되돌릴 수 있습니다.'))return;
  try{const r=await api('/admin/api/retro-variants/trash',{method:'POST',body:{game:m.id,force}});toast('휴지통으로 옮겼습니다. 파일 '+r.files.length+'개');rvData={};loadRetroVariants();}
  catch(err){if(/다른 세트/.test(err.message)&&!force){
      if(confirm('다른 세트가 이 파일을 부모 롬이나 BIOS 로 씁니다. 옮기면 그 세트는 실행되지 않습니다. 그래도 옮길까요?'))rvTrash(m,true);return;}
    toast(err.message);}
}
async function rvRestore(i){
  try{await api('/admin/api/retro-variants/restore',{method:'POST',body:{entry:i.entry}});toast('되돌렸습니다.');rvData={};loadRetroVariants();}catch(err){toast(err.message);}
}

let rvFilterT=0;$('rv-filter').addEventListener('input',()=>{clearTimeout(rvFilterT);rvFilterT=setTimeout(rvShow,200);});
$('rv-broken').addEventListener('change',rvShow);
`;
