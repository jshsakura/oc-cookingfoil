/**
 * The settings tab's "서버 동작" block: device approval, uploads, the share inbox, the public
 * address, names, titledb, the outside lookups and the safe restart, each saved
 * the moment it is changed and applied without a restart. Talks to
 * /admin/api/server-settings, and to /admin/api/server/* for the restart button.
 */

import { top, topLabel } from "./top-i18n.js";

export const SERVER_SETTINGS_HTML = `<div class="hd"><h2 class="first" data-top="m.setServer">${top("m.setServer")}</h2></div>
  <p class="muted">${top("ss.lede")}</p>
  <div class="box-jump" id="ss-jump" role="tablist" ${topLabel("ss.jumpLabel")}></div>
  <div id="ss-list" class="ss-list"></div>`;

export const SERVER_SETTINGS_CSS = `
.ss-list{display:grid;gap:14px;margin:10px 0 26px}
.ss-list>.box{margin:0;scroll-margin-top:12px}
.ss-group>.box-b{padding-top:2px;padding-bottom:4px}
.ss-row{display:grid;grid-template-columns:1fr minmax(220px,420px);gap:6px 18px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
.ss-group .ss-row:first-child{border-top:0}
.ss-row b{font-size:var(--fs-md)}.ss-row p{margin:2px 0 0;color:var(--muted);font-size:var(--fs-xs);line-height:1.5}
.ss-row .ss-ctl{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.ss-row .ss-ctl input[type=text],.ss-row .ss-ctl input[type=number],.ss-row .ss-ctl select{width:100%;min-width:0}
.ss-src{grid-column:1/-1;font-size:var(--fs-xs);color:var(--muted)}.ss-src button{font-size:var(--fs-xs);padding:2px 8px;margin-left:6px}
.ss-switch{position:relative;display:inline-block;vertical-align:middle;width:46px;height:26px;flex:none}
.ss-switch input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer}
.ss-switch span{position:absolute;inset:0;border-radius:var(--r-pill);background:var(--sunk);border:1px solid var(--line);transition:background .15s}
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
    ['ratingSync','bool',()=>topText('ss.f.ratingSync'),()=>topText('ss.f.ratingSyncD')],
    ['fillMissingArt','bool',()=>topText('ss.f.fillMissingArt'),()=>topText('ss.f.fillMissingArtD')],
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
const ssShow=(k,v)=>Array.isArray(v)?v.join(','):SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1]==='gb'?ssGb(v)+' GB':typeof v==='boolean'?(v?topText('ov.on'):topText('ov.off')):ssText(SS_GROUPS.flatMap((g)=>g[1]).find((r)=>r[0]===k)?.[1].find?.((o)=>o[0]===String(v))?.[1]||v)||topText('ss.empty');
// The overview owns the health summary; a standalone settings page has none.
function ssRefreshHealth(){if(typeof loadHealth==='function')loadHealth();}
async function ssSave(body,msg){try{const d=await api('/admin/api/server-settings',{method:'POST',body});toast(msg||topText('pp.saved'));ssRender(d);ssRefreshHealth();}
  catch(err){const row=SS_GROUPS.flatMap((g)=>g[1]).find((r)=>String(err.message).startsWith(r[0]+' '));
    toast(row?topFill('ss.badValue',{f:ssText(row[2])}):err.message);loadServerSettings();}}
function ssControl(key,kind,s,ph){
  if(kind==='bool'){const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=s.value===true;b.setAttribute('aria-label',key);
    b.addEventListener('change',()=>ssSave({[key]:b.checked},topText((b.checked?'ss.on.':'ss.off.')+key)));w.append(b,el('span'));return w;}
  if(kind==='gb'){const i=el('input');i.type='number';i.min='0.001';i.step='any';i.inputMode='decimal';i.value=ssGb(s.value);i.setAttribute('aria-label',key);
    const unit=el('span','GB','muted');
    i.addEventListener('change',()=>{const v=Math.round(Number(i.value)*GIB);if(!(v>0)){toast(topText('ss.sizePositive'));i.value=ssGb(s.value);return;}ssSave({[key]:v});});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,unit);return w;}
  if(kind==='sec'){const i=el('input');i.type='number';i.min='1';i.step='1';i.inputMode='numeric';i.value=String(s.value);i.setAttribute('aria-label',key);
    i.addEventListener('change',()=>{if(!/^[1-9][0-9]*$/.test(i.value)){toast(topText('ss.secPositive'));i.value=String(s.value);return;}ssSave({[key]:i.value});});
    const w=el('span');w.style.cssText='display:flex;align-items:center;gap:8px;width:100%';w.append(i,el('span',topText('ss.secUnit'),'muted'));return w;}
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
      if(key==='fillMissingArt'&&d.artFill)t.append(el('p',topFill('ss.artFillCounts',{t:num(d.artFill.titledb),p:num(d.artFill.plugin),m:num(d.artFill.missing)}),'muted'));
      const src=el('div',null,'ss-src');
      if(s.source==='saved'){src.append(topFill('ss.srcSaved',{v:ssShow(key,s.envValue)}));
        src.append(tbtn('restore','ss.srcRevertBtn',()=>ssSave({[key]:null},topText('ss.srcReverted'))));}
      r.append(t,c);if(src.childNodes.length)r.append(src);g.append(r);}
    if(title==='gameinfo'){const r=el('div',null,'ss-row');const t=el('div');const tdb=d.titledb||{};
      t.append(el('b',topText('ss.tdbTitle')),el('p',tdb.fetching?topText('ss.tdbFetching'):(tdb.titles?topFill('ss.tdbCount',{n:tdb.titles.toLocaleString()})+(tdb.loadedAt?topFill('ss.tdbLoaded',{t:fmt(tdb.loadedAt)}):'')+'.':topText('ss.tdbNone'))));
      const c=el('div',null,'ss-ctl');c.append(tbtn('download','ss.tdbFetchBtn',async()=>{try{const x=await api('/admin/api/server-settings/titledb-refresh',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
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
function ssDirectNote(h){return h.up?topText('ss.directUp')+(h.since?' '+topFill('ss.directSince',{t:fmt(h.since)}):'')
  :topText('ss.directDown');}
function ssRestartRow(){const r=el('div',null,'ss-row');const t=el('div');const note=el('p',topText('ss.statusLoading'));
  t.append(el('b',topText('ss.restartTitle')),note);
  api('/admin/api/server/status').then((st)=>{note.textContent=st.draining?topFill('ss.restarting',{n:st.inflight})
    :topFill('ss.restartPlan',{d:st.downloads,i:st.inflight});}).catch(()=>{});
  const c=el('div',null,'ss-ctl');c.append(tbtn('restart','ss.grpRestart',async()=>{
    if(!await ask(topText('ss.restartAsk')))return;
    try{const x=await api('/admin/api/server/restart',{method:'POST',body:{}});toast(x.message);note.textContent=x.message;}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
function ssSyncRow(st){const r=el('div',null,'ss-row');const t=el('div');
  const parts=(st.last?.parts||[]).map((p)=>({games:topText('t.root.games'),homebrew:topText('t.root.homebrew'),saves:topText('t.root.saves'),patches:topText('t.root.patches'),retro:topText('t.root.retro'),gameMeta:topText('ss.grpGameinfo')}[p.name]||p.name)+(p.error?' '+topText('ss.fail'):''));
  t.append(el('b',topText('ss.syncTitle')),el('p',st.running?topText('ss.syncRunning'):st.last?topFill('ss.syncLast',{t:fmt(st.last.at),s:Math.max(1,Math.round(st.last.ms/1000)),parts:parts.join(', ')})+(st.next?topFill('ss.syncNext',{t:fmt(st.next)}):'.'):topText('ss.syncNever')));
  const c=el('div',null,'ss-ctl');c.append(tbtn('retry','ss.syncBtn',async()=>{try{const x=await api('/admin/api/server-settings/sync-now',{method:'POST',body:{}});toast(x.message);loadServerSettings();setTimeout(loadServerSettings,5000);}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
function ssBackupRow(st){const r=el('div',null,'ss-row');const t=el('div');const kept=st.kept||[];
  const total=kept.reduce((a,b)=>a+b.bytes,0);
  t.append(el('b',topText('ss.backupTitle')),el('p',st.last?.error?topFill('ss.backupFailed',{e:st.last.error})
    :kept.length?topFill('ss.backupKept',{n:kept.length,mb:(total/1048576).toFixed(1),day:kept[0].day}):topText('ss.backupNone')));
  const c=el('div',null,'ss-ctl');c.append(tbtn('copy','ss.backupBtn',async()=>{try{const x=await api('/admin/api/server-settings/backup-now',{method:'POST',body:{}});toast(x.message);loadServerSettings();}catch(err){toast(err.message);}}));
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
  const line=!k.present?topText('ss.keysAbsent'):topFill('ss.keysLine',{src:k.source==='upload'?(k.uploadedAt?topFill('ss.keysUploaded',{t:fmt(k.uploadedAt)}):topText('s.upload')):topText('ss.keysOnServer'),n:k.keyCount});
  const st=el('p',line);st.id='keys-status';
  t.append(el('b','prod.keys'),st,...ssKeysReach(k),el('p',topText('ss.keysAdvice')),
    el('p',topText('ss.keysUploadNote')));
  const c=el('div',null,'ss-ctl');const f=el('input');f.type='file';f.accept='.keys,text/plain';f.setAttribute('aria-label',topText('ss.keysFile'));
  f.addEventListener('change',async()=>{const file=f.files[0];if(!file)return;
    if(file.size>65536){toast(topText('ss.keysTooBig'));f.value='';return;}
    try{await api('/admin/api/keys',{method:'PUT',body:{text:await file.text()}});toast(topText('ss.keysAdded'));loadServerSettings();ssRefreshHealth();}
    catch(err){toast(err.message);f.value='';}});
  c.append(f);
  if(k.source==='upload')c.append(tbtn('delete','ss.keysRemoveBtn',async()=>{if(!await ask(topText('ss.keysRemoveAsk'),{danger:true}))return;
    try{await api('/admin/api/keys',{method:'DELETE'});toast(topText('ss.keysRemoved'));loadServerSettings();ssRefreshHealth();}catch(err){toast(err.message);}}));
  r.append(t,c);return r;}
async function loadServerSettings(){ssRender(await api('/admin/api/server-settings'));}
`;
