/**
 * The settings tab's "서버 동작" block: device approval, uploads, the share inbox, the public
 * address, names, titledb, the outside lookups and the safe restart, each saved
 * the moment it is changed and applied without a restart. Talks to
 * /admin/api/server-settings, and to /admin/api/server/* for the restart button.
 */

export const SERVER_SETTINGS_HTML = `<div class="hd"><h2 class="first">서버 동작</h2></div>
  <p class="muted">바꾸면 바로 저장하고 다시 띄우지 않아도 적용합니다. 여기서 바꾸지 않은 것은 compose 의 값을 그대로 씁니다.</p>
  <div class="box-jump" id="ss-jump" role="tablist" aria-label="서버 동작 묶음"></div>
  <div id="ss-list" class="ss-list"></div>`;

export const SERVER_SETTINGS_CSS = `
.ss-list{display:grid;gap:14px;margin:10px 0 26px}
.ss-list>.box{margin:0;scroll-margin-top:12px}
.ss-group>.box-b{padding-top:2px;padding-bottom:4px}
.ss-row{display:grid;grid-template-columns:1fr minmax(220px,420px);gap:6px 18px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
.ss-group .ss-row:first-child{border-top:0}
.ss-row b{font-size:14px}.ss-row p{margin:2px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}
.ss-row .ss-ctl{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.ss-row .ss-ctl input[type=text],.ss-row .ss-ctl input[type=number],.ss-row .ss-ctl select{width:100%;min-width:0}
.ss-src{grid-column:1/-1;font-size:12px;color:var(--muted)}.ss-src button{font-size:12px;padding:2px 8px;margin-left:6px}
.ss-switch{position:relative;display:inline-block;vertical-align:middle;width:46px;height:26px;flex:none}
.ss-switch input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer}
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
    ['devicePairing','bool','QR 로 기기 연결','CookingFoil 클라이언트가 QR 을 띄우고, 휴대폰으로 찍어 승인합니다. 끄면 콘솔이 접속할 수 없습니다.'],
    ['deviceApproval',[['manual','관리자가 하나씩 승인합니다'],['signin','연결할 때 아이디와 비밀번호를 넣은 기기는 바로 승인합니다'],['all','연결을 요청하는 기기를 모두 승인합니다']],'승인 방식','콘솔은 접속할 때 비밀번호를 쓰지 않습니다. 아이디와 비밀번호는 연결할 때 한 번만 받아서 그 기기를 바로 승인하는 데 씁니다. 모두 승인은 내 기기만 닿을 수 있는 서버에서만 씁니다.'],
    ['deviceLimit',[['0',()=>topText('ss.deviceLimitNone')],...[1,2,3,5,10,15,20,30,50].map((n)=>[String(n),()=>topFill(n===5?'ss.deviceLimitDefault':'ss.deviceLimitN',{n})])],()=>topText('ss.deviceLimit'),()=>topText('ss.deviceLimitD')],
  ]],
  ['로그인',[
    ['passwordLogin','bool','아이디·비밀번호 로그인','끄면 대시보드와 관리 페이지에는 Google 계정으로만 로그인하고, 계정 비밀번호는 어디서도 받지 않습니다. 비밀번호로 로그인해 있던 사람과 비밀번호 계정이 만든 토큰도 그동안 쓸 수 없습니다. 이미 승인된 콘솔은 기기 키로 계속 붙고, 새 콘솔은 QR 로 승인합니다. Google 로그인이 켜져 있고 관리자로 승인된 Google 계정이 있어야 끌 수 있으며, 나중에 둘 중 하나라도 없어지면 비밀번호 로그인이 저절로 다시 켜집니다. Google 쪽이 고장 나 들어올 수 없으면 compose 에 COOK_PASSWORD_LOGIN_FORCE=true 를 넣고 다시 시작합니다.'],
  ]],
  ['대시보드',[
    ['uploadsEnabled','bool','웹에서 올리기','로그인한 사용자가 대시보드에서 파일과 표지를 올릴 수 있습니다. 관리 페이지의 업로드 탭은 이 설정과 상관없이 씁니다.'],
    ['publicBaseUrl','text','공개 주소','리버스 프록시나 터널 뒤에 둘 때 바깥에서 들어오는 주소를 넣습니다. 비우면 요청이 들어온 주소를 씁니다.','https://files.example.org'],
  ]],
  ['임시 공유',[
    ['inboxEnabled','bool','임시 공유 받기','로그인한 사용자가 대시보드의 계정 메뉴에서 파일, 메모, 링크를 남길 수 있습니다. 남긴 것은 임시 공유 탭에서 봅니다.'],
    ['inboxMaxBytes','gb','한 번에 올리는 크기','파일을 모두 합친 크기입니다. GB 단위로 넣습니다.'],
    ['inboxQuotaBytes','gb','임시 공유함 전체 크기','이만큼 차면 새로 올리는 것을 받지 않고 가득 찼다고 알립니다. GB 단위로 넣습니다.'],
  ]],
  ['이름과 아이콘',[
    ['extractIcons',[['missing','목록에 없는 것만 파일에서 읽습니다'],['all','모든 파일에서 읽습니다'],['off','파일에서 읽지 않습니다']],'파일에서 이름과 아이콘 읽기','바꾸면 라이브러리를 다시 읽습니다.'],
    ['langPriority','list','이름 언어 순서','앞에 둔 언어의 이름부터 씁니다. 쉼표로 나눕니다.','ko,en,ja'],
  ]],
  ['prod.keys',[]],
  ['게임 정보',[
    ['titledbAutoFetch','bool','자동으로 다운로드','게임 이름과 설명 목록(titledb)을 하루에 한 번 새로 받습니다. 끄면 받아 둔 것만 씁니다.'],
    ['titledbRegions','list','받을 지역','비우면 기본 지역을 모두 받습니다. 쉼표로 나눕니다.','KR.ko,US.en,JP.ja'],
    ['titledbSource','text','다운로드 주소','지역별 파일(KR.ko.json 등)이 있는 주소입니다. 비우면 blawar/titledb 에서 받습니다. 원본이 멈추면 포크나 미러 주소로 변경합니다. 바꾼 뒤 지금 받기를 누르면 새 주소에서 받습니다.','https://raw.githubusercontent.com/<계정>/titledb/master'],
  ]],
  ['다운로드',[
    ['downloadMaxConnections',[['1','1개'],['2','2개'],['3','3개'],['4','4개 (기본)'],['5','5개'],['6','6개'],['7','7개'],['8','8개']],'기기당 동시 연결','기기 하나가 파일 하나를 받을 때 동시에 여는 연결 수의 상한을 클라이언트에 알려 줍니다. 서버가 막지는 않으며, 줄이면 서버 부담이 줄고 늘리면 먼 곳에서 빨라질 수 있습니다.'],
    ['directDownloads','bool','외부 다운로드 전용 주소 사용','끄면 아래 주소를 지우지 않고 쉬게 합니다. 모든 기기가 목록에 적힌 공개 주소(터널)로 받습니다. 두 경로의 속도를 비교할 때 씁니다.'],
    ['publicDirectBaseUrl','text','외부 다운로드 전용 주소','https 주소만 넣을 수 있습니다. 넣으면 이 기능을 지원하는 클라이언트가 https 로 로그인했을 때 다운로드 토큰을 함께 받고, 목록의 다운로드 주소가 이 주소로 바뀝니다. 집 안에서 http 로 서버에 바로 붙은 기기는 지금처럼 그 주소로 받습니다. 이 주소 앞의 프록시는 Bearer 토큰이 붙은 GET/HEAD 요청만 이 서버로 넘겨야 하고, 이 주소로는 다운로드만 받을 수 있습니다. 다른 클라이언트와 브라우저는 지금처럼 받습니다. 비우면 쓰지 않습니다.','https://dl.example.org:38443'],
    ['downloadLinkTtl',[['3600','1시간'],['21600','6시간 (기본)'],['43200','12시간'],['86400','하루'],['259200','3일'],['604800','일주일']],'토큰 유효 시간','다운로드 토큰은 이 시간이 지나면 쓸 수 없습니다. 클라이언트는 목록을 다시 받을 때 새 토큰을 받습니다.'],
  ]],
  ['다시 시작',[
    ['restartRetryAfter','sec','재요청 대기 시간','다시 시작하는 동안 들어온 요청에 이 시간만큼 기다렸다가 다시 요청하라고 알립니다(Retry-After). 서버가 다시 켜지는 데 걸리는 시간에 맞춥니다.'],
    ['restartGrace','sec','받던 것을 기다리는 시간','다시 시작할 때 이미 받고 있던 요청이 끝나기를 이만큼까지 기다리고, 그때도 남은 것은 끊습니다. compose 의 stop_grace_period(40초) 안에 들도록 35초까지 넣습니다.'],
  ]],
  ['동기화와 백업',[
    ['syncHours',[['0','누를 때만'],['1','1시간마다'],['3','3시간마다'],['6','6시간마다 (기본)'],['12','12시간마다'],['24','하루마다']],'모든 폴더 다시 읽기','게임, 홈브류, 세이브, 패치, 레트로 폴더를 이 주기로 처음부터 다시 읽습니다. 넣은 파일은 폴더 감시가 바로 잡으니, 이것은 놓친 것을 채우는 용도입니다.'],
    ['verifyHours',[['2-7','새벽 2시~7시 (기본)'],['0-6','자정~6시'],['1-7','새벽 1시~7시'],['3-8','새벽 3시~8시'],['22-6','밤 10시~아침 6시'],['always','언제나'],['off','하지 않습니다']],'파일 검사 시간','라이브러리 파일이 수정되거나 손상됐는지 이 시간에만 읽어 확인합니다. 디스크를 오래 읽으니 쓰지 않는 시간에 둡니다. 시간이 끝나면 읽던 파일까지만 마치고 다음 날 이어서 합니다. 관리자가 직접 다시 검사를 누른 파일은 시간과 상관없이 바로 합니다.'],
    ['backupDays',[['0','하지 않습니다'],['7','7일'],['14','14일 (기본)'],['30','30일'],['90','90일']],'매일 백업 보관','계정, 기기, 토큰, 설정, 감사 기록, 다운로드 기록, 손으로 고친 이름과 설명을 하루에 한 번 데이터 폴더의 backups 에 복사하고, 이 기간이 지난 것은 삭제합니다. 롬과 이미지처럼 다시 받을 수 있는 것은 넣지 않습니다.'],
    ['trashNoticeDays',[['7',()=>topFill('t.days',{n:7})],['14',()=>topFill('t.days',{n:14})],['30',()=>topFill('t.daysDefault',{n:30})],['90',()=>topFill('t.days',{n:90})],['365',()=>topText('t.oneYear')]],()=>topText('t.noticeLabel'),()=>topText('t.noticeDesc')],
    ['retroScaffold','bool',()=>topText('ss.scaffold'),()=>topText('ss.scaffoldD')],
    ['logKeepDays',[['7','7일'],['30','30일 (기본)'],['90','90일'],['180','180일'],['365','1년']],'기록 보관 기간','변환 기록과 다운로드 기록을 이 기간만큼 남기고, 지난 것은 지웁니다. 줄이면 바로 적용됩니다.'],
  ]],
  ['외부 정보',[
    ['eshopPrices','bool','공식 스토어 가격','게임 상세에 가격과 할인을 보여 줍니다.'],
    ['eshopPopularity','bool','인기순','인기순 정렬에 쓰는 순위를 받습니다.'],
    ['eshopArtwork','bool','공식 이미지','아이콘, 배너, 스크린샷을 받아 둡니다. 끄면 받아 둔 것, 파일에서 읽은 것, 직접 올린 것만 씁니다.'],
    ['ratingSync','bool','평점 모으기','Steam, IGDB, 레트로 평점을 천천히 모읍니다.'],
    ['retroMeta','bool','레트로 게임 정보','LaunchBox 와 IGDB 에서 레트로 게임의 설명, 제작사, 발매일, 장르, 스크린샷을 천천히 받아 둡니다. 스크린샷은 공식 이미지가 켜져 있을 때만 받습니다. 끄면 받아 둔 것만 씁니다.'],
    ['retroAutoCores','bool',()=>topText('ss.autoCores'),()=>topText('ss.autoCoresD')],
    ['retroPackUrl','text','RetroArch 번들 주소','레트로 탭의 "한 번에 채우기"가 RetroArch 번들(.7z)을 받아 오는 주소입니다. 비워 두면 libretro 공식 주소를 씁니다. 어느 주소든 서버에 고정된 SHA-256 과 같은 파일만 받아들입니다.','https://...'],
  ]],
];
// A label or description may be a function, for the rows shown in the admin page's own language.
const ssText=(v)=>typeof v==='function'?v():v;
const GIB=1024**3;
const ssGb=(v)=>String(Math.round(v/GIB*1000)/1000);
const ssShow=(k,v)=>Array.isArray(v)?v.join(','):SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1]==='gb'?ssGb(v)+' GB':typeof v==='boolean'?(v?'켜짐':'꺼짐'):(SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1].find?.((o)=>o[0]===String(v))?.[1])||v||'비어 있음';
async function ssSave(body,msg){try{const d=await api('/admin/api/server-settings',{method:'POST',body});toast(msg||'저장했습니다.');ssRender(d);loadHealth();}
  catch(err){const row=SS_GROUPS.flatMap((g)=>g[1]).find((r)=>String(err.message).startsWith(r[0]+' '));
    toast(row?ssText(row[2])+' 값이 맞지 않습니다. 고쳐서 다시 넣습니다.':err.message);loadServerSettings();}}
function ssControl(key,kind,s,ph){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>ssSave({[key]:b.checked},b.checked?'켰습니다.':'껐습니다.'));w.append(b,el('span'));return w;}
  if(kind==='gb'){const i=el('input');i.type='number';i.min='0.001';i.step='any';i.inputMode='decimal';i.value=ssGb(s.value);i.setAttribute('aria-label',key);
    const unit=el('span','GB','muted');
    i.addEventListener('change',()=>{const v=Math.round(Number(i.value)*GIB);if(!(v>0)){toast('0 보다 큰 크기를 넣습니다.');i.value=ssGb(s.value);return;}ssSave({[key]:v});});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,unit);return w;}
  if(kind==='sec'){const i=el('input');i.type='number';i.min='1';i.step='1';i.inputMode='numeric';i.value=String(s.value);i.setAttribute('aria-label',key);
    i.addEventListener('change',()=>{if(!/^[1-9][0-9]*$/.test(i.value)){toast('1 이상의 초를 넣습니다.');i.value=String(s.value);return;}ssSave({[key]:i.value});});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,el('span','초','muted'));return w;}
  if(Array.isArray(kind)){const sel=el('select');for(const [v,t] of kind){const o=el('option',ssText(t));o.value=v;sel.append(o);}sel.value=s.value;
    sel.addEventListener('change',()=>ssSave({[key]:sel.value}));return sel;}
  const i=el('input');i.type='text';i.spellcheck=false;i.autocomplete='off';i.maxLength=300;i.placeholder=ph||'';
  i.value=Array.isArray(s.value)?s.value.join(','):(s.value||'');
  i.addEventListener('change',()=>ssSave({[key]:i.value}));i.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();i.blur();}});return i;}
let ssLast=null;
// Drawn again in the new language when the admin switches it.
function ssRelabel(){if(ssLast)ssRender(ssLast);}
function ssRender(d){ssLast=d;const list=$('ss-list');list.replaceChildren();const jump=$('ss-jump');jump.replaceChildren();
  for(const [title,rows] of SS_GROUPS){const box=boxEl('ss-'+SS_GROUPS.findIndex((x)=>x[0]===title),title,'','ss-group');const g=box.querySelector('.box-b');
    const a=el('button',title);a.type='button';a.setAttribute('role','tab');a.dataset.group=title;a.addEventListener('click',()=>ssShowGroup(title));jump.append(a);box.dataset.group=title;
    for(const [key,kind,label,desc,ph] of rows){const s=d.settings[key];if(!s)continue;const r=el('div',null,'ss-row');r.dataset.key=key;
      const t=el('div');t.append(el('b',ssText(label)),el('p',ssText(desc)));const c=el('div',null,'ss-ctl');c.append(ssControl(key,kind,s,ph));
      if(key==='publicDirectBaseUrl'&&d.directDownload?.configured)t.append(el('p',ssDirectNote(d.directDownload),'muted'));
      const src=el('div',null,'ss-src');
      if(s.source==='saved'){src.append('여기서 정한 값입니다. compose 값은 '+ssShow(key,s.envValue)+' 입니다.');
        src.append(btn('compose 값으로',()=>ssSave({[key]:null},'compose 값으로 돌렸습니다.')));}
      r.append(t,c);if(src.childNodes.length)r.append(src);g.append(r);}
    if(title==='게임 정보'){const r=el('div',null,'ss-row');const t=el('div');const tdb=d.titledb||{};
      t.append(el('b','지금 새로 다운로드'),el('p',tdb.fetching?'다운로드하고 있습니다.':(tdb.titles?'게임 '+tdb.titles.toLocaleString()+'개의 정보가 있습니다'+(tdb.loadedAt?'. 마지막으로 읽은 때: '+fmt(tdb.loadedAt):'')+'.':'아직 받은 게임 정보가 없습니다.')));
      const c=el('div',null,'ss-ctl');c.append(btn('지금 다운로드',async()=>{try{const x=await api('/admin/api/server-settings/titledb-refresh',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
      r.append(t,c);g.append(r);}
    if(title==='prod.keys')g.append(ssKeysRow(d.keys||{}));
    if(title==='다시 시작')g.append(ssRestartRow());
    if(title==='동기화와 백업')g.append(ssSyncRow(d.sync||{}),ssBackupRow(d.backup||{}));
    list.append(box);}
  ssShowGroup(ssGroup());}
// One group on screen at a time; the last one picked comes back after a reload.
function ssGroup(){try{const g=localStorage.getItem('ss-group');if(SS_GROUPS.some((x)=>x[0]===g))return g;}catch(e){}return SS_GROUPS[0][0];}
function ssShowGroup(title){try{localStorage.setItem('ss-group',title);}catch(e){}
  for(const b of $('ss-jump').children)b.setAttribute('aria-selected',String(b.dataset.group===title));
  for(const g of $('ss-list').children)g.hidden=g.dataset.group!==title;}
function ssDirectNote(h){return h.up?'외부 다운로드 전용 주소가 지금 응답합니다.'+(h.since?' '+fmt(h.since)+'부터 응답하고 있습니다.':'')
  :'외부 다운로드 전용 주소가 지금 응답하지 않습니다. 요청이 오는 동안 1분마다 다시 확인하고, 상태가 바뀌면 알립니다.';}
function ssRestartRow(){const r=el('div',null,'ss-row');const t=el('div');const note=el('p','지금 받고 있는 수를 읽고 있습니다.');
  t.append(el('b','안전하게 다시 시작합니다'),note);
  api('/admin/api/server/status').then((st)=>{note.textContent=st.draining?'다시 시작하고 있습니다. 남은 요청 '+st.inflight+'개가 끝나면 꺼졌다가 다시 켜집니다.'
    :'새 요청에는 잠시 뒤 다시 요청하라고 알리고, 받고 있던 것은 끝까지 보낸 뒤 서버를 껐다가 켭니다. 지금 다운로드 '+st.downloads+'개, 요청 '+st.inflight+'개가 진행 중입니다.';}).catch(()=>{});
  const c=el('div',null,'ss-ctl');c.append(btn('다시 시작',async()=>{
    if(!await ask('서버를 안전하게 다시 시작합니다. 받고 있던 것이 끝나면 잠시 꺼졌다가 다시 켜집니다.'))return;
    try{const x=await api('/admin/api/server/restart',{method:'POST',body:{}});toast(x.message);note.textContent=x.message;}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
function ssSyncRow(st){const r=el('div',null,'ss-row');const t=el('div');
  const parts=(st.last?.parts||[]).map((p)=>({games:'게임',homebrew:'홈브류',saves:'세이브',patches:'패치',retro:'레트로',gameMeta:'게임 정보'}[p.name]||p.name)+(p.error?' 실패':''));
  t.append(el('b','지금 동기화'),el('p',st.running?'모든 폴더를 다시 읽고 있습니다.':st.last?'마지막으로 다 읽은 때: '+fmt(st.last.at)+' ('+Math.max(1,Math.round(st.last.ms/1000))+'초, '+parts.join(', ')+')'+(st.next?'. 다음은 '+fmt(st.next)+'입니다.':'.'):'서버를 켠 뒤로 아직 다시 읽지 않았습니다. 켤 때 한 번 읽었습니다.'));
  const c=el('div',null,'ss-ctl');c.append(btn('지금 동기화',async()=>{try{const x=await api('/admin/api/server-settings/sync-now',{method:'POST',body:{}});toast(x.message);loadServerSettings();setTimeout(loadServerSettings,5000);}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
function ssBackupRow(st){const r=el('div',null,'ss-row');const t=el('div');const kept=st.kept||[];
  const total=kept.reduce((a,b)=>a+b.bytes,0);
  t.append(el('b','지금 백업'),el('p',st.last?.error?'마지막 백업이 실패했습니다: '+st.last.error
    :kept.length?'백업 '+kept.length+'개를 두고 있습니다(모두 '+(total/1048576).toFixed(1)+' MB). 가장 최근: '+kept[0].day+'.':'아직 만든 백업이 없습니다.'));
  const c=el('div',null,'ss-ctl');c.append(btn('지금 백업',async()=>{try{const x=await api('/admin/api/server-settings/backup-now',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
// The console keys: what the server has, a file to hand in, and removing an uploaded copy.
function ssKeysRow(k){const r=el('div',null,'ss-row');r.dataset.key='prodKeys';const t=el('div');
  const line=!k.present?'없음':'있음 · '+(k.source==='upload'?'업로드'+(k.uploadedAt?' · '+fmt(k.uploadedAt):''):'서버에 둔 파일')+' · 키 '+k.keyCount+'개';
  const st=el('p',line);st.id='keys-status';
  t.append(el('b','prod.keys'),st,el('p','넣는 것을 권장합니다. 서버는 이 키로 스위치 게임 파일마다 어떤 게임인지 읽어 정리하고, 이름과 아이콘, NSZ 변환, 홈 화면 바로가기도 만듭니다. 키가 없으면 파일 이름의 [타이틀ID][vN] 로만 게임을 알아봅니다.'),
    el('p','자기 기기에서 덤프한 prod.keys 를 올립니다. 올린 것은 데이터 폴더에만 두고, 서버에 따로 둔 파일은 건드리지 않습니다.'));
  const c=el('div',null,'ss-ctl');const f=el('input');f.type='file';f.accept='.keys,text/plain';f.setAttribute('aria-label','prod.keys 파일');
  f.addEventListener('change',async()=>{const file=f.files[0];if(!file)return;
    if(file.size>65536){toast('prod.keys 는 64 KB 를 넘을 수 없습니다.');f.value='';return;}
    try{await api('/admin/api/keys',{method:'PUT',body:{text:await file.text()}});toast('prod.keys 를 넣었습니다. 라이브러리를 다시 읽습니다.');loadServerSettings();loadHealth();}
    catch(err){toast(err.message);f.value='';}});
  c.append(f);
  if(k.source==='upload')c.append(btn('지우기',async()=>{if(!await ask('올린 prod.keys 를 지웁니다. 서버에 따로 둔 파일이 없으면 그때부터 스위치 게임 파일을 분석하지 못하고 파일 이름으로만 알아봅니다.'))return;
    try{await api('/admin/api/keys',{method:'DELETE'});toast('올린 prod.keys 를 지웠습니다.');loadServerSettings();loadHealth();}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
async function loadServerSettings(){ssRender(await api('/admin/api/server-settings'));}
`;
