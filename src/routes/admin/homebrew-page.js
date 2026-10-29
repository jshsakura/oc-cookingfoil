/** Homebrew apps, recommendations and tracked repositories. */
import { icon } from "../../views/icons.js";
import { box } from "./boxes.js";
import { top, topLabel, topPh } from "./top-i18n.js";
import { FOLDER_MARK } from "./files-panel.js";
export const HOMEBREW_HTML = /* html */ `<section id="tab-homebrew" hidden>
  <div class="subtabs hide-bar" id="homebrew-subtabs" role="tablist" ${topLabel("hp.areaAria")}>
    <button type="button" role="tab" data-sub="folder" aria-selected="true">${icon("folder")}${top("m.files")}</button>
    <button type="button" role="tab" data-sub="apps" aria-selected="false">${icon("package")}${top("ht.apps")}</button>
    <button type="button" role="tab" data-sub="reco" aria-selected="false">${icon("star")}${top("ht.reco")}</button>
    <button type="button" role="tab" data-sub="sources" aria-selected="false">${icon("download")}${top("hb.addRepoTitle")}</button>
  </div>
  <div data-sub-panel="folder">${FOLDER_MARK}</div>
  <div data-sub-panel="apps" hidden>
  <div class="hd"><h2 class="first">${top("ht.apps")}</h2><div class="actions"><button type="button" id="hb-rescan">${top("ra.reload")}</button><button type="button" id="hb-adopt">${top("hb.adopt")}</button></div></div>
  <p class="muted">${top("hb.appsLede")}</p>
  ${box("hb-apps-help", top("hb.helpTitle"), `<p class="muted">${top("hb.helpLede")}</p>`, { level: "h3" })}
  <div id="hb-held" class="hb-held" hidden></div>
  <div class="scroll" id="hb-apps" data-skel></div>
  </div>
  <div data-sub-panel="reco" hidden>
  <div class="hd"><h2 class="first">${top("ht.reco")}</h2><div class="actions"><button type="button" id="hb-add-picked">${top("hb.addPicked")}</button><button type="button" class="primary" id="hb-add-all">${top("hb.addAll")}</button></div></div>
  <p class="muted">${top("hb.recoLede")}</p>
  <div class="hb-reco" id="hb-reco" data-skel></div>
  </div>
  <div data-sub-panel="sources" hidden>
  <div class="hd"><h2 class="first">${top("hb.addRepoTitle")}</h2></div>
  <form class="add" id="hb-add">
    <input id="hb-repo" autocomplete="off" spellcheck="false" ${topPh("hb.repoPh")} ${topLabel("hb.repoLabel")} required maxlength="200">
    <input id="hb-asset" autocomplete="off" spellcheck="false" ${topPh("hb.assetPh")} ${topLabel("hb.assetLabel")} maxlength="100">
    <button class="primary" type="submit">${top("hb.addBtn")}</button>
  </form>
  <p class="muted">${top("hb.addLede")}</p>
  <div class="hd"><h2>${top("hb.registTitle")}</h2><button type="button" id="hb-check-all">${top("hb.checkAll")}</button></div>
  <div class="scroll" id="hb-sources" data-skel></div>
  </div>
</section>`;

export const HOMEBREW_DIALOG_HTML = /* html */ `<dialog id="hb-banner" class="hb-banner" aria-labelledby="hb-banner-title">
  <h3 id="hb-banner-title"></h3>
  <p class="muted">${top("hb.bannerLede")}</p>
  <h4>${top("hb.bgTitle")}</h4>
  <div class="hb-banner-now" id="hb-banner-now"><img id="hb-banner-img" alt="" ${topLabel("hb.nowImg")}><p class="muted" id="hb-banner-none">${top("hb.noImg")}</p></div>
  <form class="add" id="hb-banner-search"><input id="hb-banner-q" ${topLabel("ra.query")} ${topPh("hb.qPh")}><button class="primary">${top("ra.findSgdb")}</button></form>
  <p class="muted" id="hb-banner-state" aria-live="polite"></p>
  <div class="hb-banner-grid" id="hb-banner-results"></div>
  <div class="row-actions">
    <label class="btn-like" for="hb-banner-file">${top("hb.bgUpload")}</label><input type="file" id="hb-banner-file" accept="image/*" hidden>
    <button type="button" id="hb-banner-remove" class="danger">${top("hb.bgRemove")}</button>
  </div>
  <h4>${top("hb.shots")} <span class="muted" id="hb-shots-count"></span></h4>
  <div class="hb-shots" id="hb-shots"></div>
  <p class="muted" id="hb-shots-state" aria-live="polite"></p>
  <div class="dialog-actions">
    <label class="btn-like" for="hb-shots-file">${top("hb.shotsUpload")}</label><input type="file" id="hb-shots-file" accept="image/*" multiple hidden>
    <button type="button" id="hb-shots-clear" class="danger">${top("hb.shotsClear")}</button>
    <button type="button" id="hb-banner-close" data-top="acc.close">${top("acc.close")}</button>
  </div>
</dialog>
<dialog id="hb-desc" aria-labelledby="hb-desc-title">
  <h3 id="hb-desc-title"></h3>
  <p class="muted" id="hb-desc-hint"></p>
  <form class="desc-form" id="hb-desc-form" method="dialog">
    <label>${top("hb.descEn")}<textarea id="hb-desc-en" maxlength="2000"></textarea></label>
    <label>${top("hb.descKo")}<textarea id="hb-desc-ko" maxlength="2000"></textarea></label>
    <div class="dialog-actions">
      <button type="button" id="hb-desc-reset">${top("hb.descReset")}</button>
      <button type="button" id="hb-desc-close" data-top="acc.close">${top("acc.close")}</button>
      <button type="submit" class="primary" data-top="fp.save">${top("fp.save")}</button>
    </div>
  </form>
</dialog>
`;

export const HOMEBREW_SCRIPT = /* js */ `
async function loadHomebrew(){
  const d=await api('/admin/api/homebrew');
  const reco=$('hb-reco');hbReco=d.recommended||[];
  paged(reco,{key:'hb-reco',label:topText('ht.reco'),def:12,items:d.recommended||[],
    match:(r,q)=>(r.repo+' '+(r.purpose.ko||'')+' '+(r.purpose.en||'')).toLowerCase().includes(q),
    render:(rows)=>{reco.replaceChildren();
      for(const r of rows){const l=el('label');const c=el('input');c.type='checkbox';c.value=r.repo;c.disabled=r.added;c.checked=!r.added&&hbPicked.has(r.repo);
        c.addEventListener('change',()=>{if(c.checked)hbPicked.add(r.repo);else hbPicked.delete(r.repo);});
        l.classList.toggle('added',r.added);const t=el('div');t.append(el('b',r.repo),el('span',(r.purpose.ko||r.purpose.en)+(r.added?' · '+topText('hb.addedTag'):'')));
        l.append(c,t);reco.append(l);}}});
  paged($('hb-sources'),{key:'hb-sources',label:topText('hb.registTitle'),def:25,items:d.sources||[],
    match:(s,q)=>(s.repo+' '+(s.description?.github||'')+' '+(s.description?.custom?.ko||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>{const m=$('hb-sources');if(m._grid){m._grid.destroy();m._grid=null;}
      if(!rows.length){m.replaceChildren(el('div',q?topText('hb.noMatch'):topText('hb.none'),'empty'));return;}
      const grid=el('div',null,'src-cards');grid.append(...rows.map(hbSourceCard));m.replaceChildren(grid);}});
  hbManual=d.manual||[];hbSources=d.sources||[];loadHbApps();}
// One registered repository as a card: name and description on top, the file, state and last check in the
// middle, the buttons in the footer.
function hbSourceCard(s){const card=el('article',null,'src-card');
  const head=el('div',null,'src-head');const a=el('a',s.repo);a.href='https://github.com/'+s.repo;a.target='_blank';a.rel='noopener';
  head.append(a,el('span',s.cached?.version||s.tag||'—','src-ver'));card.append(head);
  const shown=s.description?.custom?(s.description.custom.ko||s.description.custom.en||topText('hb.noDesc')):s.description?.github;
  if(shown)card.append(el('p',shown,'src-desc'));
  const facts=el('dl',null,'src-facts');const fact=(k,v)=>{const d=el('div');d.append(el('dt',k));const dd=el('dd');dd.append(v);d.append(dd);facts.append(d);};
  if((s.assets||[]).length>1||s.pattern){const sel=el('select');sel.setAttribute('aria-label',topText('hb.assetShort'));
    const auto=el('option',s.chosen?topFill('hb.autoAsset',{v:s.chosen}):topText('hb.autoAssetNone'));auto.value='';sel.append(auto);
    for(const n of s.assets){const o=el('option',n);o.value=n;sel.append(o);}
    if(s.pattern&&!s.assets.includes(s.pattern)){const o=el('option',s.pattern);o.value=s.pattern;sel.append(o);}
    sel.value=s.pattern||'';sel.addEventListener('change',()=>setHbAsset(s.repo,sel.value));fact(topText('hb.assetFact'),sel);}
  else fact(topText('hb.assetFact'),s.chosen||'—');
  const when=el('span',ago(s.checked_at));when.title=fmt(s.checked_at);fact(topText('hb.checkedAt'),when);
  card.append(facts);
  const st=el('div',null,'src-state');const pills=el('div',null,'pills');st.append(pills);
  if(s.error){pills.append(pill(topText('hb.errorPill'),'off'));st.append(el('div',s.error.message,'err'));}
  else if(s.cached)pills.append(pill(s.cached.current?topFill('hb.cached',{size:mb(s.cached.size)}):topText('hb.stale'),s.cached.current?'on':'warn'));
  else pills.append(pill(s.checked_at?topText('hb.notFetched'):topText('hb.unchecked')));
  if(s.install){const folder=s.install.mode==='folder';
    const how=pill(folder?topFill('hb.folderInstall',{n:s.folder_files}):topText('hb.nroOnly'),folder?'on':null);
    if(!folder&&topText('hb.reason.'+s.install.reason))how.title=topText('hb.reason.'+s.install.reason);
    pills.append(how);
    for(const x of s.install.excluded||[])st.append(el('div',topFill('hb.excluded',{rule:topText('hb.ex.'+x.rule)||x.rule,paths:x.paths.join(', ')}),'muted'));
    if(s.install.rules?.length){const d=el('details');d.append(el('summary',topText('hb.whySummary')),el('div',s.install.rules.join(' · '),'muted'));st.append(d);}}
  card.append(st);
  const foot=el('div',null,'src-foot');
  foot.append(hbKind(s.id,s.kind),tbtn('info','hb.descBtn',()=>editHbDesc(s.id,s.cached?.name||s.repo,s.description)),tbtn('retry','hb.checkBtn',(e)=>checkHb(s.repo,s.tag,e.currentTarget)),tbtn('delete','pp.delete',()=>removeHb(s.repo),'danger'));
  card.append(foot);return card;}
let hbManual=[],hbSources=[],hbReco=[];const hbPicked=new Set();
// Every app with its own patches and saves: upload jumps to the upload tab with the app already chosen.
async function loadHbApps(){let d;try{d=await api('/admin/api/homebrew/apps');}catch(err){toast(err.message);return;}
  const held=d.held||[];$('hb-held').hidden=!held.length;
  $('hb-held').replaceChildren(...held.map((h)=>{const p=el('p');p.append(el('b','switch/'+h.folder+'/'),' '+h.reason);return p;}));
  // Only the patches and saves an app has; uploading one is a button in the card's footer.
  const extras=(type,items)=>{if(!items.length)return null;const c=el('div',null,'hb-extras');
    for(const it of items){const line=el('div',null,'xline');line.append(el('em',type==='patch'?topText('u.kPatch'):topText('u.kSave'),'hb-xk'),el('span',it.name+' · '+mb(it.size)));
      line.append(verifyPill(it.name,it.verified,async(next)=>{
        try{await api('/admin/api/content/'+type+'/verified',{method:'POST',body:{id:it.id,verified:next}});toast(next?topFill('hb.verifyOn',{name:it.name}):topFill('hb.verifyOff',{name:it.name}));}
        catch(err){toast(err.message);}loadHbApps();}));
      if(type==='patch'){const e=tbtn('edit','hb.editBtn',()=>ctOpen('patch',it,loadHbApps));e.setAttribute('aria-label',topFill('hb.editAria',{name:it.name}));line.append(e);}
      const x=tbtn('delete','pp.delete',()=>removeHbExtra(type,it.id,it.name),'danger');x.setAttribute('aria-label',it.name+' '+topText('pp.delete'));line.append(x);c.append(line);}
    return c;};
  paged($('hb-apps'),{key:'hb-apps',label:topText('ht.apps'),def:24,items:d.apps||[],
    match:(a,q)=>((a.name||'')+' '+(a.app||'')+' '+(a.repo_url||'')+' '+(a.title_id||'')).toLowerCase().includes(q),
    render:(rows,list,q)=>{const m=$('hb-apps');
      if(!rows.length){m.replaceChildren(el('div',q?topText('hb.appNoMatch'):topText('hb.appNone'),'empty'));return;}
      const grid=el('div',null,'src-cards');grid.append(...rows.map((a)=>hbAppCard(a,extras)));m.replaceChildren(grid);}});}
// One app as a card the way the client shows it: its picture with the size on it, the icon and name with
// the on/off switch, the kind as chips, then its patches and saves and the buttons as one row of icons.
function hbAppCard(a,extras){const name=a.name||a.app;const card=el('article',null,'src-card hb-app'+(a.enabled?'':' hb-off'));
  const media=el('div',null,'hb-media');if(a.banner_url)media.style.backgroundImage='url("'+a.banner_url+'")';
  const iconUrl=a.custom_icon_url||'/api/homebrew/'+encodeURIComponent(a.id)+'/icon?size=sm';
  // Without a banner the icon, blurred, fills the picture so the card is never a blank box.
  if(!a.banner_url){const bg=el('img',null,'hb-media-blur');bg.alt='';bg.loading='lazy';bg.src=iconUrl;bg.onerror=()=>bg.remove();media.append(bg);}
  media.append(el('span',mb(a.size),'hb-size'));
  const head=el('div',null,'src-head');
  const icon=el('img',null,'hb-icon');icon.alt='';icon.loading='lazy';icon.src=iconUrl;
  icon.onerror=()=>icon.replaceWith(el('span',String(name||'?').slice(0,1),'hb-icon hb-icon-none'));
  const title=el('div',null,'hb-title');title.append(el('b',name));
  const where=a.install_type==='title'?topFill('hp.installNsp',{id:a.title_id}):'switch/'+a.app+'/';
  title.append(el('span',(a.version?'v'+a.version+' · ':'')+(a.source==='github'?'GitHub '+(a.repo_url||'').replace('https://github.com/',''):topText('hb.manualSrc'))+' · '+where,'muted'));
  title.title=name;
  const w=el('label',null,'ss-switch');const b=el('input');b.type='checkbox';b.checked=a.enabled;b.setAttribute('aria-label',topFill('hb.enableAria',{name}));
  b.addEventListener('change',()=>setHbEnabled(a.id,b.checked,name));w.append(b,el('span'));
  head.append(icon,title,w);
  // Tried on a console: the library and the client show a 검수됨 badge on it.
  const tags=el('div',null,'hb-tags');tags.append(hbVerify(a),hbKind(a.id,a.kind));
  if(a.install_type!=='title')tags.append(hbCores(a.id,a.cores,name));
  card.append(media,head,tags);
  // An installable title has no switch/<app>/ folder for patches and saves to go under.
  if(a.app)for(const x of [extras('patch',a.patches),extras('save',a.saves)])if(x)card.append(x);
  const manual=hbManual.find((m)=>m.id===a.id);
  const desc=manual?.description||hbSources.find((s)=>s.id===a.id)?.description||{custom:null,github:a.description||null};
  const repo=(a.repo_url||'').replace('https://github.com/','');
  const foot=el('div',null,'src-foot hb-foot');
  if(a.app)for(const [key,type,shortKey] of [['rpt.apply','patch','u.kPatch'],['up.entry','save','u.kSave']]){
    const short=topText(shortKey),u=tbtn('upload',key,()=>uploadFor(type,a.app),'hb-up');
    if(type==='save'){const label=topText(key)+' · '+short;u.title=label;u.setAttribute('aria-label',label);}
    u.querySelector('span').textContent=short;foot.append(u);}
  foot.append(tbtn('info','hb.descBtn',()=>editHbDesc(a.id,name,desc)),tbtn('image','hb.pictureBtn',()=>openHbBanner(a)));
  if(a.replaceable)foot.append(btn(topText('t.hbReplace'),()=>pickHbFile(a,name)));
  if(a.source==='manual')foot.append(tbtn('link','hb.linkBtn',()=>linkHb(a)),tbtn('delete','pp.delete',()=>removeManualHb(a.id,name),'danger'));
  else if(repo)foot.append(tbtn('retry','hb.checkBtn',(e)=>checkHb(repo,null,e.currentTarget)),tbtn('remove','fp.remove',()=>removeHb(repo),'danger'));
  card.append(foot);return card;}
// The picture behind an app's header: SteamGridDB's wide backgrounds, an upload, or none.
let hbBannerApp=null;
function hbBannerShow(url){const img=$('hb-banner-img');img.hidden=!url;if(url)img.src=url;$('hb-banner-none').hidden=Boolean(url);$('hb-banner-remove').hidden=!url;
  // An app turned off is not served publicly: its preview says so instead of a broken picture.
  img.onerror=()=>{img.hidden=true;$('hb-banner-none').hidden=false;$('hb-banner-none').textContent=topText('hb.offNoPreview');};
  $('hb-banner-none').textContent=topText('hb.noImg');}
function hbShotsShow(urls){const n=(urls||[]).length;$('hb-shots-count').textContent=n?topFill('hb.shotsN',{n}):topText('hb.noneVal');$('hb-shots-clear').hidden=!n;
  $('hb-shots').replaceChildren(...(urls||[]).map((u,i)=>{const f=el('figure');const img=el('img');img.src=u;img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
    const x=btn('✕',()=>hbShotRemove(i+1));x.setAttribute('aria-label',topFill('hb.shotRemoveAria',{n:i+1}));f.append(img,x);return f;}));}
// The dialog stays open while pictures change; the list behind it is read again when it closes.
async function hbMediaReload(){const d=await api('/admin/api/homebrew/apps');const a=(d.apps||[]).find((x)=>x.id===hbBannerApp.id);
  if(a){hbBannerApp=a;hbBannerShow(a.banner_url);hbShotsShow(a.screenshots);}}
async function hbShotRemove(n){if(!await ask(topFill('hb.askShotRemove',{n}),{danger:true}))return;
  try{await api('/admin/api/homebrew/shots/remove',{method:'POST',body:{id:hbBannerApp.id,n}});await hbMediaReload();}catch(err){toast(err.message);}}
function openHbBanner(a){hbBannerApp=a;$('hb-banner-title').textContent=topFill('hb.bannerTitle',{name:a.name||a.app});hbBannerShow(a.banner_url);hbShotsShow(a.screenshots);$('hb-shots-state').textContent='';
  $('hb-banner-q').value='';$('hb-banner-results').replaceChildren();$('hb-banner-state').textContent='';$('hb-banner').showModal();hbBannerSearch();}
async function hbBannerSearch(){const st=$('hb-banner-state');st.textContent=topText('ra.searching');$('hb-banner-results').replaceChildren();
  try{const d=await api('/admin/api/homebrew/banner/candidates?id='+encodeURIComponent(hbBannerApp.id)+'&q='+encodeURIComponent($('hb-banner-q').value.trim()));
    $('hb-banner-q').value=d.q||'';st.textContent=d.items.length?topText('hb.pickNow'):topFill('hb.noBannerFound',{q:d.q});
    $('hb-banner-results').replaceChildren(...d.items.map((it)=>{const b=el('button');b.type='button';b.setAttribute('aria-label',topFill('hb.pickAria',{name:it.game.name}));
      const img=el('img');img.src=it.thumb;img.alt='';img.loading='lazy';b.append(img);b.addEventListener('click',()=>hbBannerPick(it));
      const f=el('figure');f.style.margin='0';f.append(b,el('figcaption',it.game.name));return f;}));}
  catch(err){st.textContent=err.message;}}
async function hbBannerPick(it){$('hb-banner-state').textContent=topText('ra.downloading');
  try{await api('/admin/api/homebrew/banner',{method:'POST',body:{id:hbBannerApp.id,url:it.url,game:it.game}});toast(topText('hb.bgChanged'));await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}}
$('hb-banner-search').addEventListener('submit',(e)=>{e.preventDefault();hbBannerSearch();});
$('hb-banner-close').addEventListener('click',()=>$('hb-banner').close());
$('hb-banner').addEventListener('close',()=>loadHbApps());
$('hb-shots-clear').addEventListener('click',async()=>{if(!await ask(topText('hb.askShotsClear'),{danger:true}))return;
  try{await api('/admin/api/homebrew/shots/remove',{method:'POST',body:{id:hbBannerApp.id}});await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-shots-file').addEventListener('change',async()=>{const files=[...$('hb-shots-file').files];$('hb-shots-file').value='';if(!files.length)return;
  const st=$('hb-shots-state');let done=0;
  for(const file of files){st.textContent=topFill('hb.uploadingN',{i:done+1,n:files.length});
    try{const r=await chunkedFetch('/admin/api/homebrew/shots/upload?id='+encodeURIComponent(hbBannerApp.id),file,{headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'}});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||topText('u.rFail'));done++;}
    catch(err){st.textContent=file.name+': '+err.message;break;}}
  if(done===files.length)st.textContent=topFill('hb.shotsUploaded',{n:done});await hbMediaReload();});
$('hb-banner-remove').addEventListener('click',async()=>{if(!await ask(topText('hb.askBgRemove'),{danger:true}))return;
  try{await api('/admin/api/homebrew/banner/remove',{method:'POST',body:{id:hbBannerApp.id}});toast(topText('hb.bgRemoved'));await hbMediaReload();}catch(err){toast(err.message);}});
$('hb-banner-file').addEventListener('change',async()=>{const file=$('hb-banner-file').files[0];$('hb-banner-file').value='';if(!file)return;
  $('hb-banner-state').textContent=topText('hb.uploading');
  try{const r=await chunkedFetch('/admin/api/homebrew/banner/upload?id='+encodeURIComponent(hbBannerApp.id),file,{headers:{'Content-Type':file.type||'application/octet-stream',Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||topText('u.rFail'));toast(topText('hb.bgUploaded'));await hbMediaReload();}
  catch(err){$('hb-banner-state').textContent=err.message;}});
async function removeHbExtra(type,id,name){if(!await ask(topFill(type==='patch'?'t.askPatch':'t.askSave',{name}),{danger:true}))return;
  try{await api('/admin/api/homebrew/extra/remove',{method:'POST',body:{type,id}});toast(topText('t.movedToast'));loadHbApps();}catch(err){toast(err.message);}}
async function setHbEnabled(id,enabled,name){
  try{await api('/admin/api/homebrew/enabled',{method:'POST',body:{id,enabled}});toast(enabled?topFill('hb.showAgain',{name}):topFill('hb.hidden',{name}));loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A pill, not a second switch beside 켜기: green with a shield once someone tried the item on a console.
// Patch and save rows use it too; onClick gets the value to set.
function hbVerify(a){const name=a.name||a.app;return verifyPill(name,a.verified,(next)=>setHbVerified(a.id,next,name));}
async function setHbVerified(id,verified,name){
  try{await api('/admin/api/homebrew/verified',{method:'POST',body:{id,verified}});toast(verified?topFill('hb.verifyOn',{name}):topFill('hb.verifyOff',{name}));loadHbApps();}
  catch(err){toast(err.message);loadHbApps();}}
// A hand-placed app linked to its GitHub repository: the server follows the repository, then the hand-placed copy can go.
async function linkHb(a){const input=await askText(topFill('hb.linkQ',{name:a.name||a.app}));
  if(!input||!input.trim())return;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:input.trim()}});
    if(s&&!s.error&&await ask(topFill('hb.linkRemoveQ',{repo:s.repo,name:a.name||a.app}),{danger:true})){
      await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id:a.id}});toast(topText('hb.linkedToast'));}
    else toast(s?.error?.message?topFill('hb.linkFollowFail',{repo:s.repo,msg:s.error.message}):topText('hb.repoAdded'));
    loadHomebrew();}catch(err){toast(err.message);}}
async function removeManualHb(id,name){if(!await ask(topFill('t.askHbApp',{name}),{danger:true}))return;
  try{await api('/admin/api/homebrew/manual/remove',{method:'POST',body:{id}});toast(topText('t.movedToast'));loadHomebrew();}catch(err){toast(err.message);}}
// A new build of a hand-placed app, same format as now: the server keeps its folder, so its id and what was added by hand stay.
function pickHbFile(a,name){const ext=a.install_type==='title'?'.nsp':'.nro';
  const input=el('input');input.type='file';input.accept=ext;
  input.addEventListener('change',()=>{const file=input.files[0];if(file)replaceHbFile(a,name,file);});input.click();}
async function replaceHbFile(a,name,file){if(!await ask(topFill('t.askHbReplace',{name,file:file.name}),{danger:true}))return;
  toast(topFill('t.hbReplacing',{name}));
  try{const r=await chunkedKind('homebrew',[file],{fields:{replace:a.id}});
    const d=r.d||{};if(r.status!==200&&r.status!==201)throw new Error(d.error||(r.status?'HTTP '+r.status:topText('u.rNet')));
    toast(topFill('t.hbReplacedToast',{name,old:d.replaced}));loadHomebrew();}
  catch(err){toast(err.message);}}
// Tool or port: a port (a program brought over from another system) is listed apart by the client.
function hbKind(id,kind){const sel=el('select');sel.setAttribute('aria-label',topText('hb.kindAria'));
  for(const [v,t] of [['tool',topText('hb.kindTool')],['port',topText('u.kPort')]]){const o=el('option',t);o.value=v;if(v===kind)o.selected=true;sel.append(o);}
  sel.addEventListener('change',async()=>{try{await api('/admin/api/homebrew/kind',{method:'POST',body:{id,kind:sel.value}});toast(sel.value==='port'?topText('hb.toPort'):topText('hb.toTool'));}catch(err){toast(err.message);loadHomebrew();}});
  return sel;}
// CPU cores for the app's HOME-menu shortcut: 4 only for an app that starts a thread on core 3.
function hbCores(id,cores,name){const sel=el('select','', 'hb-cores');sel.setAttribute('aria-label',topFill('hb.coresAria',{name}));
  for(const [v,t] of [[3,topText('hb.core3')],[4,topText('hb.core4')]]){const o=el('option',t);o.value=String(v);if(v===cores)o.selected=true;sel.append(o);}
  sel.addEventListener('change',async()=>{const want=Number(sel.value);
    if(want===4&&!await ask(topText('hb.core4Warn'))){sel.value='3';return;}
    try{await api('/admin/api/homebrew/cores',{method:'POST',body:{id,cores:want}});toast(want===4?topText('hb.shortcut4'):topText('hb.shortcutDef'));}catch(err){toast(err.message);loadHomebrew();}});
  return sel;}
let hbDescId=null;
function editHbDesc(id,name,d){hbDescId=id;
  $('hb-desc-title').textContent=topFill('hb.descTitle',{name});
  $('hb-desc-hint').textContent=d?.github?topFill('hb.descHintGithub',{g:d.github}):topText('hb.descHint');
  $('hb-desc-en').value=d?.custom?(d.custom.en||''):(d?.github||'');$('hb-desc-ko').value=d?.custom?.ko||'';
  $('hb-desc-reset').hidden=!d?.github;$('hb-desc').showModal();}
$('hb-desc-close').addEventListener('click',()=>$('hb-desc').close());
$('hb-desc-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/homebrew/description',{method:'POST',body:{id:hbDescId,en:$('hb-desc-en').value,ko:$('hb-desc-ko').value}});
    $('hb-desc').close();toast(topText('hb.descSaved'));loadHomebrew();}catch(err){toast(err.message);}});
$('hb-desc-reset').addEventListener('click',async()=>{if(!await ask(topText('hb.descResetQ'),{danger:true}))return;
  try{await api('/admin/api/homebrew/description/reset',{method:'POST',body:{id:hbDescId}});$('hb-desc').close();toast(topText('hb.descResetToast'));loadHomebrew();}catch(err){toast(err.message);}});
async function addHbRecommended(repos){
  if(!repos.length){toast(topText('hb.pickSome'));return;}
  try{const r=await api('/admin/api/homebrew/recommended',{method:'POST',body:{repos}});
    toast(topFill('hb.addedN',{n:r.added.length}));loadHomebrew();setTimeout(loadHomebrew,8000);}catch(err){toast(err.message);}}
$('hb-add-picked').addEventListener('click',()=>{const repos=[...hbPicked];hbPicked.clear();addHbRecommended(repos);});
$('hb-add-all').addEventListener('click',async()=>{if(!await ask(topText('hb.askAddAll')))return;
  hbPicked.clear();addHbRecommended(hbReco.filter((r)=>!r.added).map((r)=>r.repo));});
$('hb-add').addEventListener('submit',async(e)=>{e.preventDefault();const b=e.submitter;if(b)b.disabled=true;
  try{const s=await api('/admin/api/homebrew',{method:'POST',body:{repo:$('hb-repo').value,asset:$('hb-asset').value}});
    $('hb-repo').value='';$('hb-asset').value='';toast(s?.error?topFill('hb.addedNoCheck',{msg:s.error.message}):topText('hb.addedToast'));loadHomebrew();}
  catch(err){toast(err.message);}finally{if(b)b.disabled=false;}});
async function setHbAsset(repo,asset){
  try{const s=await api('/admin/api/homebrew/asset',{method:'POST',body:{repo,asset}});toast(s?.error?s.error.message:topText('hb.assetChanged'));loadHomebrew();}catch(err){toast(err.message);}}
// A check can download a new build, so it may take a while: the button waits, and the toast says whether anything changed.
async function checkHb(repo,before,b){
  if(b){if(b.disabled)return;b.disabled=true;b.setAttribute('aria-busy','true');}
  toast(topText('hb.checking'));
  try{const s=await api('/admin/api/homebrew/check',{method:'POST',body:{repo}});
    toast(s?.error?s.error.message:s?.tag&&s.tag!==before?topFill('hb.checkedNew',{tag:s.tag}):s?.tag?topFill('hb.checkedSame',{tag:s.tag}):topText('hb.checkedToast'));loadHomebrew();}
  catch(err){toast(err.message);}
  finally{if(b){b.disabled=false;b.removeAttribute('aria-busy');}}}
$('hb-check-all').addEventListener('click',async()=>{const b=$('hb-check-all');b.disabled=true;toast(topText('hb.checking'));
  try{await api('/admin/api/homebrew/check',{method:'POST',body:{}});toast(topText('hb.checkedAllToast'));loadHomebrew();}catch(err){toast(err.message);}finally{b.disabled=false;}});
$('hb-rescan').addEventListener('click',async()=>{const b=$('hb-rescan');b.disabled=true;
  try{await api('/admin/api/homebrew/rescan',{method:'POST',body:{}});toast(topText('hb.rescanToast'));}
  catch(err){toast(err.message);}finally{b.disabled=false;}});
$('hb-adopt').addEventListener('click',async()=>{const b=$('hb-adopt');b.disabled=true;
  try{const r=await api('/admin/api/homebrew/adopt',{method:'POST',body:{}});
    toast(r.registered.length?topFill('hb.adopted',{list:r.registered.join(', ')}):topText('hb.adoptNone')+(r.skipped.length?topFill('hb.adoptSkipped',{list:r.skipped.map((x)=>x.folder+' ('+x.reason+')').join(', ')}):''));loadHomebrew();}
  catch(err){toast(err.message);}finally{b.disabled=false;}});
async function removeHb(repo){if(!await ask(topFill('hb.removeQ',{repo}),{danger:true}))return;
  try{await api('/admin/api/homebrew/remove',{method:'POST',body:{repo}});toast(topText('pp.deleted'));loadHomebrew();}catch(err){toast(err.message);}}



`;
