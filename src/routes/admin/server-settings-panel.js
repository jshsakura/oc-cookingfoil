/**
 * The settings tab's "서버 동작" block: device approval, uploads, the share inbox, the public
 * address, names, titledb, the outside lookups and the safe restart, each saved
 * the moment it is changed and applied without a restart. Talks to
 * /admin/api/server-settings, and to /admin/api/server/* for the restart button.
 */

import { top } from "./top-i18n.js";

export const SERVER_SETTINGS_HTML = `<div class="hd"><h2 class="first" data-top="m.setServer">${top("m.setServer")}</h2></div>
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
const SS_TITLES={device:()=>topText('ss.grpDevice'),login:()=>topText('ss.grpLogin'),dashboard:()=>topText('ss.grpDashboard'),'prod.keys':'prod.keys',gameinfo:()=>topText('ss.grpGameinfo'),download:()=>topText('ss.grpDownload'),restart:()=>topText('ss.grpRestart'),sync:()=>topText('ss.grpSync'),inbox:()=>topText('ss.grpInbox'),names:()=>topText('ss.grpNames'),lookups:()=>topText('ss.grpLookups')};
const SS_GROUPS=[
  ['device',[
    ['devicePairing','bool',()=>topText('ss.f.devicePairing'),()=>topText('ss.f.devicePairingD')],
    ['deviceApproval',[['manual',()=>topText('ss.devManual')],['signin',()=>topText('ss.devSignin')],['all',()=>topText('ss.devAll')]],()=>topText('ss.f.deviceApproval'),()=>topText('ss.f.deviceApprovalD')],
    ['deviceLimit',[['0',()=>topText('ss.deviceLimitNone')],...[1,2,3,5,10,15,20,30,50].map((n)=>[String(n),()=>topFill(n===10?'ss.deviceLimitDefault':'ss.deviceLimitN',{n})])],()=>topText('ss.deviceLimit'),()=>topText('ss.deviceLimitD')],
    ['enrollPerHour',[1,2,3,5,10,15,20].map((n)=>[String(n),()=>topFill(n===5?'ss.deviceLimitDefault':'ss.deviceLimitN',{n})]),()=>topText('ss.enrollPerHour'),()=>topText('ss.enrollPerHourD')],
  ]],
  ['login',[
    ['passwordLogin','bool',()=>topText('ss.f.passwordLogin'),()=>topText('ss.f.passwordLoginD')],
  ]],
  ['dashboard',[
    ['uploadsEnabled','bool',()=>topText('ss.uploads'),()=>topText('ss.uploadsD')],
    ['uploadMaxBytes','gb',()=>topText('ss.uploadMax'),()=>topText('ss.uploadMaxD')],
    ['publicBaseUrl','text',()=>topText('ss.f.publicBaseUrl'),()=>topText('ss.f.publicBaseUrlD'),'https://files.example.org'],
  ]],
  ['inbox',[
    ['inboxEnabled','bool',()=>topText('ss.f.inboxEnabled'),()=>topText('ss.f.inboxEnabledD')],
    ['inboxMaxBytes','gb',()=>topText('ss.f.inboxMaxBytes'),()=>topText('ss.f.inboxMaxBytesD')],
    ['inboxQuotaBytes','gb',()=>topText('ss.f.inboxQuotaBytes'),()=>topText('ss.f.inboxQuotaBytesD')],
  ]],
  ['names',[
    ['extractIcons',[['missing',()=>topText('ss.iconsMissing')],['all',()=>topText('ss.iconsAll')],['off',()=>topText('ss.iconsOff')]],()=>topText('ss.f.extractIcons'),()=>topText('ss.f.extractIconsD')],
    ['langPriority','list',()=>topText('ss.f.langPriority'),()=>topText('ss.f.langPriorityD'),'ko,en,ja'],
  ]],
  ['prod.keys',[]],
  ['gameinfo',[
    ['titledbAutoFetch','bool',()=>topText('ss.f.titledbAutoFetch'),()=>topText('ss.f.titledbAutoFetchD')],
    ['titledbRegions','list',()=>topText('ss.f.titledbRegions'),()=>topText('ss.f.titledbRegionsD'),'KR.ko,US.en,JP.ja'],
    ['titledbSource','text',()=>topText('ss.f.titledbSource'),()=>topText('ss.f.titledbSourceD'),()=>topText('ss.f.titledbSourcePh')],
  ]],
  ['download',[
    ['downloadMaxConnections',[['1',()=>topFill('ss.nCount',{n:1})],['2',()=>topFill('ss.nCount',{n:2})],['3',()=>topFill('ss.nCount',{n:3})],['4',()=>topFill('ss.nCountDef',{n:4})],['5',()=>topFill('ss.nCount',{n:5})],['6',()=>topFill('ss.nCount',{n:6})],['7',()=>topFill('ss.nCount',{n:7})],['8',()=>topFill('ss.nCount',{n:8})]],()=>topText('ss.f.downloadMaxConnections'),()=>topText('ss.f.downloadMaxConnectionsD')],
    ['directDownloads','bool',()=>topText('ss.f.directDownloads'),()=>topText('ss.f.directDownloadsD')],
    ['publicDirectBaseUrl','text',()=>topText('ss.f.publicDirectBaseUrl'),()=>topText('ss.f.publicDirectBaseUrlD'),'https://dl.example.org:38443'],
    ['downloadLinkTtl',[['3600',()=>topFill('ss.nHours',{n:1})],['21600',()=>topFill('ss.nHoursDef',{n:6})],['43200',()=>topFill('ss.nHours',{n:12})],['86400',()=>topText('ss.nDay')],['259200',()=>topFill('ss.nDays',{n:3})],['604800',()=>topText('ss.nWeek')]],()=>topText('ss.f.downloadLinkTtl'),()=>topText('ss.f.downloadLinkTtlD')],
  ]],
  ['restart',[
    ['restartRetryAfter','sec',()=>topText('ss.f.restartRetryAfter'),()=>topText('ss.f.restartRetryAfterD')],
    ['restartGrace','sec',()=>topText('ss.f.restartGrace'),()=>topText('ss.f.restartGraceD')],
  ]],
  ['sync',[
    ['syncHours',[['0',()=>topText('ss.optManual')],['1',()=>topFill('ss.nHoursEvery',{n:1})],['3',()=>topFill('ss.nHoursEvery',{n:3})],['6',()=>topFill('ss.nHoursEveryDef',{n:6})],['12',()=>topFill('ss.nHoursEvery',{n:12})],['24',()=>topText('ss.nEveryDay')]],()=>topText('ss.f.syncHours'),()=>topText('ss.f.syncHoursD')],
    ['verifyHours',[['2-7',()=>topText('ss.winNightDef')],['0-6',()=>topText('ss.winMidnight')],['1-7',()=>topText('ss.winNight17')],['3-8',()=>topText('ss.winNight38')],['22-6',()=>topText('ss.winLate')],['always',()=>topText('ss.optAlways')],['off',()=>topText('ss.optNever')]],()=>topText('ss.f.verifyHours'),()=>topText('ss.f.verifyHoursD')],
    ['backupDays',[['0',()=>topText('ss.optNever')],['7',()=>topFill('ss.nDays',{n:7})],['14',()=>topFill('ss.nDaysDef',{n:14})],['30',()=>topFill('ss.nDays',{n:30})],['90',()=>topFill('ss.nDays',{n:90})]],()=>topText('ss.f.backupDays'),()=>topText('ss.f.backupDaysD')],
    ['trashNoticeDays',[['7',()=>topFill('t.days',{n:7})],['14',()=>topFill('t.days',{n:14})],['30',()=>topFill('t.daysDefault',{n:30})],['90',()=>topFill('t.days',{n:90})],['365',()=>topText('t.oneYear')]],()=>topText('t.noticeLabel'),()=>topText('t.noticeDesc')],
    ['retroScaffold','bool',()=>topText('ss.scaffold'),()=>topText('ss.scaffoldD')],
    ['logKeepDays',[['7',()=>topFill('ss.nDays',{n:7})],['30',()=>topFill('ss.nDaysDef',{n:30})],['90',()=>topFill('ss.nDays',{n:90})],['180',()=>topFill('ss.nDays',{n:180})],['365',()=>topText('t.oneYear')]],()=>topText('ss.f.logKeepDays'),()=>topText('ss.f.logKeepDaysD')],
  ]],
  ['lookups',[
    ['eshopPrices','bool',()=>topText('ss.f.eshopPrices'),()=>topText('ss.on.eshopPrices')],
    ['eshopPopularity','bool',()=>topText('ss.f.eshopPopularity'),()=>topText('ss.f.eshopPopularityD')],
    ['eshopArtwork','bool',()=>topText('ss.f.eshopArtwork'),()=>topText('ss.f.eshopArtworkD')],
    ['ratingSync','bool',()=>topText('ss.f.ratingSync'),()=>topText('ss.f.ratingSyncD')],
    ['retroMeta','bool',()=>topText('ss.f.retroMeta'),()=>topText('ss.f.retroMetaD')],
    ['retroAutoCores','bool',()=>topText('ss.autoCores'),()=>topText('ss.autoCoresD')],
    ['retroAutoArt','bool',()=>topText('ss.autoArt'),()=>topText('ss.autoArtD')],
    ['retroPackUrl','text',()=>topText('ss.f.retroPackUrl'),()=>topText('ss.f.retroPackUrlD'),'https://...'],
  ]],
];
// A label or description may be a function, for the rows shown in the admin page's own language.
const ssText=(v)=>typeof v==='function'?v():v;
const GIB=1024**3;
const ssGb=(v)=>String(Math.round(v/GIB*1000)/1000);
const ssShow=(k,v)=>Array.isArray(v)?v.join(','):SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1]==='gb'?ssGb(v)+' GB':typeof v==='boolean'?(v?topText('ov.on'):topText('ov.off')):ssText(SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1].find?.((o)=>o[0]===String(v))?.[1]||v)||'비어 있음';
// The overview owns the health summary; a standalone settings page has none.
function ssRefreshHealth(){if(typeof loadHealth==='function')loadHealth();}
async function ssSave(body,msg){try{const d=await api('/admin/api/server-settings',{method:'POST',body});toast(msg||topText('pp.saved'));ssRender(d);ssRefreshHealth();}
  catch(err){const row=SS_GROUPS.flatMap((g)=>g[1]).find((r)=>String(err.message).startsWith(r[0]+' '));
    toast(row?ssText(row[2])+' 값이 맞지 않습니다. 고쳐서 다시 넣습니다.':err.message);loadServerSettings();}}
function ssControl(key,kind,s,ph){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>ssSave({[key]:b.checked},topText((b.checked?'ss.on.':'ss.off.')+key)));w.append(b,el('span'));return w;}
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
  for(const [title,rows] of SS_GROUPS){const t=ssText(SS_TITLES[title]);const box=boxEl('ss-'+SS_GROUPS.findIndex((x)=>x[0]===title),t,'','ss-group');const g=box.querySelector('.box-b');
    const a=el('button',t);a.type='button';a.setAttribute('role','tab');a.dataset.group=title;a.addEventListener('click',()=>ssShowGroup(title));jump.append(a);box.dataset.group=title;
    for(const [key,kind,label,desc,ph] of rows){const s=d.settings[key];if(!s)continue;const r=el('div',null,'ss-row');r.dataset.key=key;
      const t=el('div');t.append(el('b',ssText(label)),el('p',ssText(desc)));const c=el('div',null,'ss-ctl');c.append(ssControl(key,kind,s,ph));
      if(key==='publicDirectBaseUrl'&&d.directDownload?.configured)t.append(el('p',ssDirectNote(d.directDownload),'muted'));
      const src=el('div',null,'ss-src');
      if(s.source==='saved'){src.append('여기서 정한 값입니다. compose 값은 '+ssShow(key,s.envValue)+' 입니다.');
        src.append(btn('compose 값으로',()=>ssSave({[key]:null},'compose 값으로 돌렸습니다.')));}
      r.append(t,c);if(src.childNodes.length)r.append(src);g.append(r);}
    if(title==='gameinfo'){const r=el('div',null,'ss-row');const t=el('div');const tdb=d.titledb||{};
      t.append(el('b','지금 새로 다운로드'),el('p',tdb.fetching?'다운로드하고 있습니다.':(tdb.titles?'게임 '+tdb.titles.toLocaleString()+'개의 정보가 있습니다'+(tdb.loadedAt?'. 마지막으로 읽은 때: '+fmt(tdb.loadedAt):'')+'.':'아직 받은 게임 정보가 없습니다.')));
      const c=el('div',null,'ss-ctl');c.append(btn('지금 다운로드',async()=>{try{const x=await api('/admin/api/server-settings/titledb-refresh',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
      r.append(t,c);g.append(r);}
    if(title==='prod.keys')g.append(ssKeysRow(d.keys||{}));
    if(title==='restart')g.append(ssRestartRow());
    if(title==='sync')g.append(ssSyncRow(d.sync||{}),ssBackupRow(d.backup||{}));
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
// How far the keys reach (master key generation and its firmware) and how many library games need more.
function ssKeysReach(k){if(!k.present)return [];
  if(k.maxGeneration==null)return [el('p',topText('keys.noGen'))];
  const lib=k.library||{above:0,unknown:0};
  const out=[el('p',topFill('keys.gen',{gen:k.maxGeneration,fw:k.maxFirmware})),el('p',lib.above?topFill('keys.above',{n:lib.above,version:lib.version}):topText('keys.aboveNone'))];
  if(lib.unknown)out.push(el('p',topFill('keys.pending',{n:lib.unknown})));
  return out;}
// The console keys: what the server has, a file to hand in, and removing an uploaded copy.
function ssKeysRow(k){const r=el('div',null,'ss-row');r.dataset.key='prodKeys';const t=el('div');
  const line=!k.present?'없음':'있음 · '+(k.source==='upload'?'업로드'+(k.uploadedAt?' · '+fmt(k.uploadedAt):''):'서버에 둔 파일')+' · 키 '+k.keyCount+'개';
  const st=el('p',line);st.id='keys-status';
  t.append(el('b','prod.keys'),st,...ssKeysReach(k),el('p','넣는 것을 권장합니다. 서버는 이 키로 스위치 게임 파일마다 어떤 게임인지 읽어 정리하고, 이름과 아이콘, NSZ 변환, 홈 화면 바로가기도 만듭니다. 키가 없으면 파일 이름의 [타이틀ID][vN] 로만 게임을 알아봅니다.'),
    el('p','자기 기기에서 덤프한 prod.keys 를 올립니다. 올린 것은 데이터 폴더에만 두고, 서버에 따로 둔 파일은 건드리지 않습니다.'));
  const c=el('div',null,'ss-ctl');const f=el('input');f.type='file';f.accept='.keys,text/plain';f.setAttribute('aria-label','prod.keys 파일');
  f.addEventListener('change',async()=>{const file=f.files[0];if(!file)return;
    if(file.size>65536){toast('prod.keys 는 64 KB 를 넘을 수 없습니다.');f.value='';return;}
    try{await api('/admin/api/keys',{method:'PUT',body:{text:await file.text()}});toast('prod.keys 를 넣었습니다. 라이브러리를 다시 읽습니다.');loadServerSettings();ssRefreshHealth();}
    catch(err){toast(err.message);f.value='';}});
  c.append(f);
  if(k.source==='upload')c.append(btn('지우기',async()=>{if(!await ask('올린 prod.keys 를 지웁니다. 서버에 따로 둔 파일이 없으면 그때부터 스위치 게임 파일을 분석하지 못하고 파일 이름으로만 알아봅니다.',{danger:true}))return;
    try{await api('/admin/api/keys',{method:'DELETE'});toast('올린 prod.keys 를 지웠습니다.');loadServerSettings();ssRefreshHealth();}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
async function loadServerSettings(){ssRender(await api('/admin/api/server-settings'));}
`;
