/**
 * The settings tab's "서버 동작" block: device approval, uploads, the share inbox, the public
 * address, names, titledb and the outside lookups, each saved the moment it is
 * changed and applied without a restart. Talks to /admin/api/server-settings.
 */

export const SERVER_SETTINGS_HTML = `<div class="hd"><h2 class="first">서버 동작</h2></div>
  <p class="muted">바꾸면 바로 저장하고 다시 띄우지 않아도 적용합니다. 여기서 바꾸지 않은 것은 compose 의 값을 그대로 씁니다.</p>
  <div id="ss-list" class="ss-list"></div>`;

export const SERVER_SETTINGS_CSS = `
.ss-list{display:grid;gap:14px;margin:10px 0 26px}
.ss-group{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:4px 16px}
.ss-group>h3{margin:12px 0 2px;font-size:15px}
.ss-row{display:grid;grid-template-columns:1fr minmax(180px,300px);gap:6px 18px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
.ss-group>h3+.ss-row{border-top:0}
.ss-row b{font-size:14px}.ss-row p{margin:2px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}
.ss-row .ss-ctl{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.ss-row .ss-ctl input[type=text],.ss-row .ss-ctl input[type=number],.ss-row .ss-ctl select{width:100%;min-width:0}
.ss-src{grid-column:1/-1;font-size:12px;color:var(--muted)}.ss-src button{font-size:12px;padding:2px 8px;margin-left:6px}
.ss-switch{position:relative;display:inline-block;vertical-align:middle;width:46px;height:26px;flex:none}
.ss-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.ss-switch span{position:absolute;inset:0;border-radius:100px;background:var(--sunk);border:1px solid var(--line);transition:background .15s}
.ss-switch span::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--muted);transition:transform .15s,background .15s}
.ss-switch input:checked+span{background:var(--accent);border-color:var(--accent)}
.ss-switch input:checked+span::after{transform:translateX(20px);background:var(--accent-ink)}
.ss-switch input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:640px){.ss-row{grid-template-columns:1fr}.ss-row .ss-ctl{justify-content:flex-start}}
`;

export const SERVER_SETTINGS_SCRIPT = /* js */ `
const SS_GROUPS=[
  ['기기 연결',[
    ['devicePairing','bool','QR 로 기기 연결','CookingFoil 클라이언트가 QR 을 띄우고, 휴대폰으로 찍어 승인합니다. 끄면 아이디와 비밀번호로만 접속합니다.'],
    ['deviceApproval',[['manual','관리자가 하나씩 승인합니다'],['signin','계정으로 로그인한 기기는 바로 승인합니다'],['all','연결을 요청하는 기기를 모두 승인합니다']],'승인 방식','모두 승인은 내 기기만 닿을 수 있는 서버에서만 씁니다.'],
  ]],
  ['웹 화면',[
    ['uploadsEnabled','bool','웹에서 올리기','로그인한 사용자가 웹 화면에서 파일과 표지를 올릴 수 있습니다. 관리 페이지의 업로드 탭은 이 설정과 상관없이 씁니다.'],
    ['publicBaseUrl','text','공개 주소','리버스 프록시나 터널 뒤에 둘 때 바깥에서 들어오는 주소를 넣습니다. 비우면 요청이 들어온 주소를 씁니다.','https://files.example.org'],
    ['welcomeMessage','text','접속 인사','Tinfoil 방식 클라이언트가 목록을 열 때 보여 줍니다. 비우면 보이지 않습니다.',''],
  ]],
  ['임시 공유',[
    ['inboxEnabled','bool','임시 공유 받기','로그인한 사용자가 웹 화면의 계정 메뉴에서 파일, 메모, 링크를 남길 수 있습니다. 남긴 것은 임시 공유 탭에서 봅니다.'],
    ['inboxMaxBytes','gb','한 번에 올리는 크기','파일을 모두 합친 크기입니다. GB 단위로 넣습니다.'],
    ['inboxQuotaBytes','gb','임시 공유함 전체 크기','이만큼 차면 새로 올리는 것을 받지 않고 가득 찼다고 알립니다. GB 단위로 넣습니다.'],
  ]],
  ['이름과 아이콘',[
    ['extractIcons',[['missing','목록에 없는 것만 파일에서 읽습니다'],['all','모든 파일에서 읽습니다'],['off','파일에서 읽지 않습니다']],'파일에서 이름과 아이콘 읽기','바꾸면 라이브러리를 다시 읽습니다.'],
    ['langPriority','list','이름 언어 순서','앞에 둔 언어의 이름부터 씁니다. 쉼표로 나눕니다.','ko,en,ja'],
  ]],
  ['게임 정보',[
    ['titledbAutoFetch','bool','자동으로 받기','게임 이름과 설명 목록(titledb)을 하루에 한 번 새로 받습니다. 끄면 받아 둔 것만 씁니다.'],
    ['titledbRegions','list','받을 지역','비우면 기본 지역을 모두 받습니다. 쉼표로 나눕니다.','KR.ko,US.en,JP.ja'],
    ['titledbSource','text','받을 주소','지역별 파일(KR.ko.json 등)이 있는 주소입니다. 비우면 blawar/titledb 에서 받습니다. 원본이 멈추면 포크나 미러 주소로 바꿉니다. 바꾼 뒤 지금 받기를 누르면 새 주소에서 받습니다.','https://raw.githubusercontent.com/<계정>/titledb/master'],
  ]],
  ['외부 정보',[
    ['eshopPrices','bool','공식 스토어 가격','게임 상세에 가격과 할인을 보여 줍니다.'],
    ['eshopPopularity','bool','인기순','인기순 정렬에 쓰는 순위를 받습니다.'],
    ['eshopArtwork','bool','공식 이미지','아이콘, 배너, 스크린샷을 받아 둡니다. 끄면 받아 둔 것, 파일에서 읽은 것, 직접 올린 것만 씁니다.'],
    ['ratingSync','bool','평점 모으기','Steam, IGDB, 레트로 평점을 천천히 모읍니다.'],
  ]],
];
const GIB=1024**3;
const ssGb=(v)=>String(Math.round(v/GIB*1000)/1000);
const ssShow=(k,v)=>Array.isArray(v)?v.join(','):SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1]==='gb'?ssGb(v)+' GB':typeof v==='boolean'?(v?'켜짐':'꺼짐'):(SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1].find?.((o)=>o[0]===v)?.[1])||v||'비어 있음';
async function ssSave(body,msg){try{const d=await api('/admin/api/server-settings',{method:'POST',body});toast(msg||'저장했습니다.');ssRender(d);loadHealth();}
  catch(err){const row=SS_GROUPS.flatMap((g)=>g[1]).find((r)=>String(err.message).startsWith(r[0]+' '));
    toast(row?row[2]+' 값이 맞지 않습니다. 고쳐서 다시 넣습니다.':err.message);loadServerSettings();}}
function ssControl(key,kind,s,ph){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>ssSave({[key]:b.checked},b.checked?'켰습니다.':'껐습니다.'));w.append(b,el('span'));return w;}
  if(kind==='gb'){const i=el('input');i.type='number';i.min='0.001';i.step='any';i.inputMode='decimal';i.value=ssGb(s.value);i.setAttribute('aria-label',key);
    const unit=el('span','GB','muted');
    i.addEventListener('change',()=>{const v=Math.round(Number(i.value)*GIB);if(!(v>0)){toast('0 보다 큰 크기를 넣습니다.');i.value=ssGb(s.value);return;}ssSave({[key]:v});});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,unit);return w;}
  if(Array.isArray(kind)){const sel=el('select');for(const [v,t] of kind){const o=el('option',t);o.value=v;sel.append(o);}sel.value=s.value;
    sel.addEventListener('change',()=>ssSave({[key]:sel.value}));return sel;}
  const i=el('input');i.type='text';i.spellcheck=false;i.autocomplete='off';i.maxLength=300;i.placeholder=ph||'';
  i.value=Array.isArray(s.value)?s.value.join(','):(s.value||'');
  i.addEventListener('change',()=>ssSave({[key]:i.value}));i.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();i.blur();}});return i;}
function ssRender(d){const list=$('ss-list');list.replaceChildren();
  for(const [title,rows] of SS_GROUPS){const g=el('section',null,'ss-group');g.append(el('h3',title));
    for(const [key,kind,label,desc,ph] of rows){const s=d.settings[key];if(!s)continue;const r=el('div',null,'ss-row');r.dataset.key=key;
      const t=el('div');t.append(el('b',label),el('p',desc));const c=el('div',null,'ss-ctl');c.append(ssControl(key,kind,s,ph));
      const src=el('div',null,'ss-src');
      if(s.source==='saved'){src.append('여기서 정한 값입니다. compose 값은 '+ssShow(key,s.envValue)+' 입니다.');
        src.append(btn('compose 값으로',()=>ssSave({[key]:null},'compose 값으로 돌렸습니다.')));}
      r.append(t,c);if(src.childNodes.length)r.append(src);g.append(r);}
    if(title==='게임 정보'){const r=el('div',null,'ss-row');const t=el('div');const tdb=d.titledb||{};
      t.append(el('b','지금 새로 받기'),el('p',tdb.fetching?'받고 있습니다.':(tdb.titles?'게임 '+tdb.titles.toLocaleString()+'개의 정보가 있습니다'+(tdb.loadedAt?'. 마지막으로 읽은 때: '+fmt(tdb.loadedAt):'')+'.':'아직 받은 게임 정보가 없습니다.')));
      const c=el('div',null,'ss-ctl');c.append(btn('지금 받기',async()=>{try{const x=await api('/admin/api/server-settings/titledb-refresh',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
      r.append(t,c);g.append(r);}
    list.append(g);}}
async function loadServerSettings(){ssRender(await api('/admin/api/server-settings'));}
`;
