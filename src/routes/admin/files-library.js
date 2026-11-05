/**
 * The file browser's library side (files-panel.js): what the server knows about each entry
 * (library/file-facts.js) shown on its row, a folder tree on the left, a details pane on the right,
 * rows that keep coming as the list scrolls, and a copy's progress while it runs.
 */
export const LIBRARY_CSS = /* css */ `
/* The last-scan line is the rescan button's tooltip. */
.wrap:has(#fb) #scan-status{display:none}
#fb .fb-body{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start}
/* Fixed columns: a hidden pane leaves its column empty instead of the list sliding into it. */
#fb .fb-tree{grid-column:1}#fb .fb-main{grid-column:2;min-width:0}#fb .fb-side{grid-column:3}
#fb .fb-tree,#fb .fb-side{display:none;position:sticky;top:calc(var(--adm-hdr-h,0px) + 8px);max-height:calc(100vh - var(--adm-hdr-h,0px) - 96px);overflow:auto;
  border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel)}
#fb.tree-on .fb-tree{display:block;width:220px;padding:8px 6px;margin-right:12px}
#fb.side-on .fb-side{display:flex;flex-direction:column;gap:12px;width:280px;padding:16px;margin-left:12px}
#fb .fb-tree ul{list-style:none;margin:0;padding:0 0 0 14px}#fb .fb-tree>ul{padding:0}
#fb .fb-tn{display:flex;align-items:center;gap:2px;min-width:0}
#fb .fb-tn button{border:0;background:none;color:var(--text);font:inherit;padding:5px 6px;border-radius:var(--r-sm);text-align:left;justify-content:flex-start;min-width:0;min-height:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fb .fb-tn .fb-tx{flex:0 0 22px;width:22px;padding:0;display:inline-flex;justify-content:center;color:var(--muted)}
#fb .fb-tn .fb-tx .ico{transition:transform .15s}#fb .fb-tn[aria-expanded="true"] .fb-tx .ico{transform:rotate(90deg)}
#fb .fb-tn .fb-tx[hidden]{visibility:hidden;display:inline-flex}
#fb .fb-tn .fb-tl{flex:1 1 auto}
#fb .fb-tn button:hover{background:var(--sunk)}
#fb .fb-tn[aria-current="page"] .fb-tl{background:rgba(var(--accent-rgb),.12);color:var(--text);font-weight:var(--fw-bold)}
#fb .fb-gicon{width:28px;height:28px;flex:0 0 28px;border-radius:var(--r-sm);object-fit:cover;background:var(--sunk)}
:is(#fb,#fb-props) .fb-badge{flex:0 0 auto;padding:1px 7px;border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:var(--fw-bold);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
:is(#fb,#fb-props) .fb-badge[data-tone="warn"]{color:var(--warn);border-color:currentColor}
:is(#fb,#fb-props) .fb-badge[data-tone="bad"]{color:var(--bad);border-color:currentColor}
:is(#fb .fb-side,#fb-props) .fb-s-head{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
:is(#fb .fb-side,#fb-props) .fb-s-art{width:96px;height:96px;border-radius:var(--r-lg);object-fit:cover;background:var(--sunk)}
:is(#fb .fb-side,#fb-props) .fb-s-art.ico{padding:24px;color:var(--muted)}
:is(#fb .fb-side,#fb-props) .fb-s-meta{display:grid;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
:is(#fb .fb-side,#fb-props) .fb-s-about{margin:0;font-size:var(--fs-xs);line-height:1.6;color:var(--muted);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:8;overflow:hidden}
:is(#fb .fb-side,#fb-props) .fb-s-shots{display:grid;grid-template-columns:1fr 1fr;gap:6px}
:is(#fb .fb-side,#fb-props) .fb-s-shots img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-sm);background:var(--sunk)}
:is(#fb .fb-side,#fb-props) h4{margin:0;font-size:var(--fs-md);overflow-wrap:anywhere}
:is(#fb .fb-side,#fb-props) .fb-s-sub{font-size:var(--fs-xs);color:var(--faint);overflow-wrap:anywhere}
:is(#fb .fb-side,#fb-props) .fb-s-why{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--sunk);font-size:var(--fs-xs);line-height:1.55;color:var(--muted)}
#fb .fb-about{flex:0 1000 auto;min-width:0;color:var(--faint);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:is(#fb .fb-side,#fb-props) .fb-s-what{margin:0;font-size:var(--fs-sm);line-height:1.55;color:var(--muted)}
:is(#fb .fb-side,#fb-props) .fb-s-prev{display:grid;gap:6px}
:is(#fb .fb-side,#fb-props) .fb-s-prev img{display:block;max-width:100%;max-height:220px;margin:0 auto;border-radius:var(--r-md);background:var(--sunk);cursor:zoom-in}
:is(#fb .fb-side,#fb-props) .fb-s-prev pre{margin:0;max-height:180px;overflow:auto;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--sunk);font-size:var(--fs-xs);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
:is(#fb .fb-side,#fb-props) .fb-s-why strong{display:block;margin-bottom:4px;font-size:var(--fs-sm);color:var(--text)}
:is(#fb .fb-side,#fb-props) .fb-s-why p{margin:0 0 6px}
:is(#fb .fb-side,#fb-props) .fb-s-why[data-tone="bad"] strong{color:var(--bad)}
:is(#fb .fb-side,#fb-props) .fb-s-why[data-tone="warn"] strong{color:var(--warn)}
:is(#fb .fb-side,#fb-props) .fb-s-badges{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}
:is(#fb .fb-side,#fb-props) dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:0;font-size:var(--fs-sm)}
:is(#fb .fb-side,#fb-props) dt{color:var(--muted)}#fb .fb-side dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
:is(#fb .fb-side,#fb-props) .fb-s-links:empty{display:none}
:is(#fb .fb-side,#fb-props) .fb-s-link{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 10px;border-radius:var(--r-md);background:var(--sunk);font-size:var(--fs-sm)}
:is(#fb .fb-side,#fb-props) .fb-s-link+.fb-s-link{margin-top:4px}
:is(#fb .fb-side,#fb-props) .fb-s-link .ib{width:28px;height:28px;padding:0;display:inline-grid;place-items:center}
@media (max-width:760px){#fb-props .fb-s-link .ib{width:40px;height:40px}}
:is(#fb .fb-side,#fb-props) .fb-s-link .ib .ico{width:14px;height:14px}
:is(#fb .fb-side,#fb-props) .fb-s-none{color:var(--muted);font-size:var(--fs-sm);text-align:center;margin:24px 0}
#fb .fb-more{height:1px}
/* With the details pane open its buttons stand in for the row's, which leaves the names their room. */
@media (min-width:900px){#fb.side-on .c-act{display:none}}
#fb .fb-job{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
#fb .fb-job[hidden]{display:none}
#fb .fb-job progress{width:160px}
@media (max-width:899px){#fb.tree-on .fb-tree,#fb.side-on .fb-side{display:none}}
/* From tablet width up the browser is one window, as on a desktop: the toolbar on top, the tree, the list and the
   details side by side, each scrolling on its own, and the status bar at the bottom, the whole filling the screen. */
@media (min-width:900px){
  .adm-shell>.wrap:has(#fb){max-width:none}
  #fb{gap:0;height:calc(100dvh - var(--fb-top,220px) - var(--fb-below,24px));min-height:320px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel);overflow:hidden}
  #fb .fb-bar{padding:8px 10px;gap:6px;border-bottom:1px solid var(--line)}
  /* The window takes every line the screen has: the bar wraps at most once, the trash note and the scan line
     step aside (the scan line is the rescan button's tooltip), and the chat button floats over the status bar. */
  #fb .fb-crumb{flex:1 1 140px}
  #fb .fb-q{flex:0 1 220px}
  #fb .fb-bar button{height:34px}
  #fb .fb-cmds{padding:2px 10px;border-bottom:1px solid var(--line)}
  #fb .fb-bar .ib{width:34px}
  .adm-shell>.wrap:has(#fb){padding-top:calc(var(--adm-hdr-h) + 12px);padding-bottom:12px}
  body:has(.ch-launch:not([hidden])) .adm-shell>.wrap:has(#fb){padding-bottom:12px}
  #tab-library:has(#fb){position:relative}
  #tab-library:has(#fb)>.hd{position:absolute;top:0;right:0;margin:0;z-index:1}
  #tab-library:has(#fb)>.hd h2{display:none}
  #tab-library:has(#fb)>.hd #rescan{height:34px}
  #tab-library:has(#fb) #lib-subtabs{padding-right:150px}
  .wrap:has(#fb) .subtabs{margin-bottom:12px}
  #fb #fb-foot{padding:6px 12px;margin:0;min-height:0;border-width:1px 0 0;border-radius:0;box-shadow:none}
  /* Only the list gives way: however long it is, the toolbars and the status bar keep their height. */
  #fb>*{flex:none}
  #fb>.fb-body{flex:1 1 0;min-height:0;grid-template-rows:minmax(0,1fr);align-items:stretch}
  #fb .fb-tree,#fb .fb-side,#fb .fb-main{position:static;max-height:none;min-height:0;overflow:auto;border:0;border-radius:0;margin:0}
  #fb.tree-on .fb-tree{margin:0;border-right:1px solid var(--line);background:var(--sunk)}
  #fb.side-on .fb-side{margin:0;border-left:1px solid var(--line)}
  #fb .fb-main{position:relative}
  #fb .fb-wrap{border:0;border-radius:0;background:none;overflow:visible}
  #fb .fb-wrap>table{border:0;border-radius:0;margin:0;box-shadow:none;background:none}
  #fb thead th{top:0}
  #fb .fb-note{padding:6px 14px;border-top:1px solid var(--line)}
  #fb .fb-foot{position:static;min-height:60px;box-sizing:border-box;margin:0;border:0;border-top:1px solid var(--line);border-radius:0;box-shadow:none;backdrop-filter:none;background:var(--panel)}
}
`;

export const LIBRARY_SCRIPT = /* js */ `
// ── what the library knows, on each row ─────────────────────────────
const FB_KIND={base:'fb.k.base',update:'fb.k.update',dlc:'fb.k.dlc'};
const fbIconUrl=(id,size)=>'/api/library/icon/'+encodeURIComponent(id)+'?size='+size;
function fbBadge(text,tone){const b=el('span',text,'fb-badge');if(tone)b.dataset.tone=tone;return b;}
function fbBadges(f){const out=[];
  if(f.kind&&FB_KIND[f.kind])out.push(fbBadge(topText(FB_KIND[f.kind])+(f.kind!=='base'&&f.version!=null?' v'+f.version:'')));
  if(f.latest===false)out.push(fbBadge(topText('fb.old'),'warn'));
  // A modified file installs as a rule; only damage is red, and a damage that may still install is amber.
  if(f.check)out.push(fbBadge(f.why?.label||topText('fb.c.'+f.check),f.check==='modified'?'':f.why?.certain===false?'warn':'bad'));
  if(f.server)out.push(fbBadge(topText('fb.serverBadge')));
  return out;}
// What a folder or file is for, in one plain line: the server's own folders, the console folders of retro,
// a game's update and DLC folders, a game's patches and saves, and the Switch file kinds.
const FB_ABOUT_SERVER={'art-map':'fb.a.artMap',thumbnails:'fb.a.thumbs',bezels:'fb.a.bezels',screenshots:'fb.a.shots','system-icons':'fb.a.icons',
  retroarch:'fb.a.retroarch','ratings.json':'fb.a.ratings','arcade-names.json':'fb.a.arcadeNames','systems.json':'fb.a.systems'};
const FB_ABOUT_EXT={nsp:'fb.f.nsp',nsz:'fb.f.nsz',xci:'fb.f.xci',xcz:'fb.f.xcz',nro:'fb.f.nro'};
function fbAbout(f){const parts=f.rel.split('/');const dir=f.type==='dir';
  if(f.server)return FB_ABOUT_SERVER[parts[0]]?topText(FB_ABOUT_SERVER[parts[0]]):'';
  if(fb.root==='retro'){if(f.rel==='roms')return topText('fb.a.roms');
    if(dir&&parts[0]==='roms'&&parts.length===2&&f.title)return topFill('fb.a.romsOf',{name:f.title});
    if(!dir&&f.system)return topFill('fb.a.romOf',{name:f.system});}
  if(fb.root==='games'&&dir){if(f.rel==='incoming')return topText('fb.a.incoming');
    if(/^update$/i.test(f.name))return topText('fb.a.update');if(/^dlc$/i.test(f.name))return topText('fb.a.dlc');}
  if(dir&&f.titleId&&fb.root==='patches')return topText('fb.a.patchOf');
  if(dir&&f.titleId&&fb.root==='saves')return topText('fb.a.saveOf');
  if(!dir&&FB_ABOUT_EXT[f.ext])return topText(FB_ABOUT_EXT[f.ext]);
  return '';}
// The game's icon in place of the folder or file icon; the plain icon comes back when there is none yet.
function fbGameIcon(f,size,cls){const img=el('img');img.className=cls;img.alt='';img.loading='lazy';img.decoding='async';img.src=fbIconUrl(f.titleId,size);return img;}
function fbDecorate(n,f){if(f.titleId){const ic=n.querySelector('.ico');if(ic){const img=fbGameIcon(f,'md','fb-gicon');img.addEventListener('error',()=>img.replaceWith(ic),{once:true});ic.replaceWith(img);}}
  for(const b of fbBadges(f))n.append(b);
  // In the list only folders and the server's own lists say what they are; a file's kind waits in the details pane.
  const about=(f.type==='dir'||(f.server&&!f.rel.includes('/')))&&fbAbout(f);if(about){const a=el('span',about,'fb-about');a.title=about;n.append(a);}}

// ── the details pane ────────────────────────────────────────────────
// What the file check found, in the words the console shows: a title and what it means for an install.
function fbWhy(f){if(!f.why?.help)return [];const box=el('div',null,'fb-s-why');box.dataset.tone=f.check==='modified'?'':f.why.certain===false?'warn':'bad';
  box.append(el('strong',f.why.help.title),...f.why.help.body.split('\\n\\n').map((t)=>el('p',t)));return [box];}
let fbSideHeld=null;
function fbSideOn(){return $('fb').classList.contains('side-on');}
function fbSide(){if(!fbSideOn())return;const s=$('fb-side');const items=[...fb.sel].map(fbItem).filter(Boolean);
  if(items.length===1)return fbSideOne(s,items[0]);
  if(items.length>1){const files=items.filter((f)=>f.type==='file');const line=el('p',topFill('fb.side.files',{n:num(files.length),size:fbSize(files.reduce((a,f)=>a+(f.size||0),0))}),'fb-s-sub');
    s.replaceChildren(el('h4',topFill('fb.selected',{n:num(items.length)})),line);if(files.length===items.length)return;
    // A folder counts by what it holds, as it does when picked alone. A repaint of the same pick reuses the answer.
    const key=fb.root+'|'+items.map((f)=>f.rel).join('|');const show=(r)=>{line.textContent=topFill('fb.side.files',{n:num(r.files),size:fbSize(r.bytes)});};
    if(fbSideHeld?.key===key){if(fbSideHeld.r)show(fbSideHeld.r);return;}const held=fbSideHeld={key,r:null};
    api('/admin/api/files/info',{method:'POST',body:{root:fb.root,paths:items.map((f)=>f.rel)}}).then((r)=>{held.r=r;if(line.isConnected)show(r);}).catch(()=>{});return;}
  s.replaceChildren(el('p',topText('fb.side.none'),'fb-s-none'));}
// What the details pane and the properties window both open with: the picture, the name, the badges and what the item is.
function fbSideTop(f){const head=el('div',null,'fb-s-head');
  if(f.titleId){const img=fbGameIcon(f,'md','fb-s-art');img.addEventListener('error',()=>img.replaceWith(fbSideIcon(f)),{once:true});head.append(img);}else head.append(fbSideIcon(f));
  head.append(el('h4',f.title||f.name));if(f.title)head.append(el('div',f.name,'fb-s-sub'));
  const badges=fbBadges(f);if(badges.length){const b=el('div',null,'fb-s-badges');b.append(...badges);head.append(b);}
  const links=el('div',null,'fb-s-links');fbShareList(f,links);
  const about=fbAbout(f);const what=about?[el('p',about,'fb-s-what')]:[];
  return {head,top:[head,...what,...fbSidePreview(f),links]};}
function fbFacts(f){const rows=[];
  if(f.type==='file'&&(f.ownId||f.titleId))rows.push(['fb.p.titleId',f.ownId||f.titleId]);
  if(f.version!=null)rows.push(['fb.p.version','v'+f.version]);
  if(f.check)rows.push(['fb.p.check',f.why?.label||topText('fb.c.'+f.check)]);
  return rows;}
function fbSideOne(s,f){const {head,top}=fbSideTop(f);const rows=fbFacts(f);
  if(f.type==='file')rows.push(['fb.p.size',topFill('fb.p.bytes',{size:fbSize(f.size),bytes:num(f.size)})]);
  rows.push(['fb.p.mtime',fbDate(f.mtime)]);
  const dl=el('dl');dl.append(...rows.flatMap(([k,v])=>[el('dt',topText(k)),el('dd',v)]));
  if(f.type==='dir'&&f.holds){dl.append(el('dt',topText('fb.p.size')),el('dd',topFill('fb.p.bytes',{size:fbSize(f.holds.bytes),bytes:num(f.holds.bytes)})),
    el('dt',topText('fb.p.holds')),el('dd',topFill('fb.p.holdsVal',{files:num(f.holds.files),dirs:num(f.holds.dirs)})));}
  else if(f.type==='dir'){const dd=el('dd');const b=el('button',topText('fb.p.sizeAsk'));b.type='button';
    b.addEventListener('click',async()=>{b.disabled=true;b.textContent=topText('fb.p.counting');
      try{const r=await api('/admin/api/files/info',{method:'POST',body:{root:fb.root,paths:[f.rel]}});
        dd.textContent=topFill('fb.p.bytes',{size:fbSize(r.bytes),bytes:num(r.bytes)})+' · '+topFill('fb.p.holdsVal',{files:num(r.files),dirs:num(Math.max(0,r.dirs-1))});}
      catch(err){dd.textContent=err.message;}});dd.append(b);dl.append(el('dt',topText('fb.p.size')),dd);}
  s.replaceChildren(...top,dl,...fbWhy(f));fbSideMeta(s,f,head);}
// A picture shows itself and a text file its first lines, right in the pane; a click opens the full viewer.
const FB_SIDE_TEXT=2048;
function fbSidePreview(f){const kind=fbKind(f);if(!kind||(kind==='image'&&f.size>FB_THUMB_MAX))return [];
  const box=el('div',null,'fb-s-prev');const open=el('button',topText('fb.view'));open.type='button';open.addEventListener('click',()=>fbView(f));
  if(kind==='image'){const img=el('img');img.alt=f.name;img.addEventListener('click',()=>fbView(f));box.append(img,open);
    fbBlobUrl(f).then((url)=>{if(url)img.src=url;else img.remove();});return [box];}
  const pre=el('pre');box.append(pre,open);
  fetch('/admin/api/files/download?'+new URLSearchParams({root:fb.root,path:f.rel}),{headers:{Range:'bytes=0-'+(FB_SIDE_TEXT-1)}})
    .then((r)=>r.ok?r.arrayBuffer():null).then((b)=>{if(!b)return pre.remove();pre.textContent=new TextDecoder().decode(b)+(f.size>FB_SIDE_TEXT?'\\n…':'');})
    .catch(()=>pre.remove());
  return [box];}
// What is known about the game a file or folder belongs to: the same details a console shows, kept once per game.
const fbMetaKnown=new Map();
const fbMetaDate=(v)=>{const t=String(v||'');return t.length===8?t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6):t;};
function fbMetaRows(d){return [['fb.m.publisher',d.publisher],['fb.m.released',fbMetaDate(d.releaseDate)],['fb.m.genre',d.category],['fb.m.players',d.numberOfPlayers],['fb.m.region',d.region],
  ['fb.m.rating',d.rating],['fb.m.score',d.score!=null?d.score+(d.scoreLabel?' · '+d.scoreLabel:''):null],['fb.m.latest',d.latestVersion!=null?'v'+d.latestVersion:null],['fb.m.dlc',d.dlcTotal||null],['fb.m.firmware',d.requiredFirmware]]
  .filter(([,v])=>v!=null&&v!=='');}
async function fbSideMeta(s,f,head){const id=String(f.titleId||'').toUpperCase();if(!/^[0-9A-F]{16}$/.test(id))return;
  const box=el('div',null,'fb-s-meta');s.append(box);let d=fbMetaKnown.get(id);
  if(d===undefined){for(const w of [80,60,90])box.append(Object.assign(el('i',null,'sk'),{style:'width:'+w+'%'}));
    try{d=await api('/api/title/'+id+'?lang='+encodeURIComponent(adminLang));}catch{d=null;}fbMetaKnown.set(id,d);}
  if(!box.isConnected)return;box.replaceChildren();if(!d){box.remove();return;}
  if(d.name&&!f.title){head.querySelector('h4').textContent=d.name;if(!head.querySelector('.fb-s-sub'))head.querySelector('h4').after(el('div',f.name,'fb-s-sub'));}
  const rows=fbMetaRows(d);if(rows.length){const dl=el('dl');dl.append(...rows.flatMap(([k,v])=>[el('dt',topText(k)),el('dd',String(v))]));box.append(dl);}
  if(d.description)box.append(el('p',d.description,'fb-s-about'));
  const shots=(d.screenshots||[]).map((x)=>typeof x==='string'?x:x?.url).filter(Boolean).slice(0,4);
  if(shots.length){const g=el('div',null,'fb-s-shots');for(const url of shots){const a=el('a');a.href=url;a.target='_blank';a.rel='noopener';const i=el('img');i.alt='';i.loading='lazy';i.src=url;a.append(i);g.append(a);}box.append(g);}
  if(!box.childElementCount)box.remove();}

// ── share links: one file, anyone with the link, for a while (library/file-shares.js) ─
const FB_SHARE_MAX_H=720,FB_DAY_MS=864e5;
const fbYmd=(ms)=>{const d=new Date(ms);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
// A day picked stays open until that day ends.
async function fbShareAsk(){const said=await askDialog(topText('fb.shareAsk'),'',{line:topText('fb.sharePwPh'),choices:[['1','fb.share1h'],['24','fb.share1d'],['168','fb.share7d'],['date','fb.shareDate']].map(([value,k])=>({value,label:topText(k)}))});
  if(!said)return null;const password=said.line;if(said.pick!=='date')return {hours:Number(said.pick),password};const now=Date.now();
  const day=await askText(topText('fb.shareDateAsk'),fbYmd(now+FB_DAY_MS),{type:'date',min:fbYmd(now),max:fbYmd(now+30*FB_DAY_MS)});
  return day?{hours:Math.max(1,Math.min(FB_SHARE_MAX_H,Math.ceil((new Date(day+'T23:59:59')-now)/36e5))),password}:null;}
async function fbShare(f){const root=fb.root;
  const live=await api('/admin/api/files/shares?'+new URLSearchParams({root,path:f.rel})).then((x)=>x.shares.length).catch(()=>0);
  if(live&&!await ask(topFill('fb.shareMore',{n:num(live)})))return;
  const said=await fbShareAsk();
  if(!said)return;
  let r;try{r=await api('/admin/api/files/share',{method:'POST',body:{root,path:f.rel,hours:said.hours,...(said.password?{password:said.password}:{})}});}catch(err){toast(err.message);return;}
  const when=fbDate(r.expiresAt);
  // Over plain http the browser keeps the clipboard shut; the link is then shown to copy by hand.
  try{await navigator.clipboard.writeText(r.url);toast(topFill('fb.shareCopied',{when}));}
  catch{await askDialog(topFill('fb.shareCopy',{when}),r.url);}
  if(root===fb.root)fbLoad();}
async function fbShareList(f,links){const root=fb.root;let r;
  try{r=await api('/admin/api/files/shares?'+new URLSearchParams({root,path:f.rel}));}catch{return;}
  if(!links.isConnected)return;
  links.replaceChildren(...r.shares.map((sh)=>{const row=el('div',null,'fb-s-link');row.append(el('span',topFill('fb.shareUntil',{when:fbDate(sh.expiresAt)})+(sh.locked?' · '+topText('fb.shareLocked'):'')));
    const end=fbSideBtn(FB_ICON.stop,'fb.shareEnd',async()=>{try{await api('/admin/api/files/share/end',{method:'POST',body:{id:sh.id}});toast(topText('fb.shareEnded'));}
      catch(err){toast(err.message);}fbShareList(f,links);fbLoad();},'danger');row.append(end);return row;}));}
async function fbShareEndAll(f){let r;try{r=await api('/admin/api/files/shares?'+new URLSearchParams({root:fb.root,path:f.rel}));}catch(err){toast(err.message);return;}
  if(!await ask(topFill('fb.shareEndAsk',{n:num(r.shares.length)}),{danger:true}))return;
  try{for(const sh of r.shares)await api('/admin/api/files/share/end',{method:'POST',body:{id:sh.id}});toast(topText('fb.shareEnded'));}catch(err){toast(err.message);}fbLoad();}
function fbSideBtn(svg,key,fn,cls){const b=el('button',null,'ib'+(cls?' '+cls:''));b.type='button';b.innerHTML=svg;
  const t=topText(key);b.title=t;b.setAttribute('aria-label',t);b.addEventListener('click',fn);return b;}
function fbSideIcon(f){const w=el('span');w.innerHTML=f.type==='dir'?FB_ICON.dir:FB_ICON.file;const ic=w.firstChild;ic.classList.add('fb-s-art');return ic;}

// ── the folder tree ─────────────────────────────────────────────────
const fbTree={root:null,open:new Set(),kids:new Map()};
function fbTreeOn(){return $('fb').classList.contains('tree-on');}
async function fbTreeKids(rel){const d=await api('/admin/api/files/list?'+new URLSearchParams({root:fb.root,path:rel,only:'dirs',perPage:'500'}));
  const list=d.items.map((i)=>({rel:i.rel,name:i.title||i.name}));fbTree.kids.set(rel,list);fbTreeLeaves(list);return list;}
// Which of these folders hold no folder, from the sizes cache, so their arrow is gone before anyone presses it.
async function fbTreeLeaves(list){const root=fb.root;const ask=list.filter((k)=>!fbSizes.has(root+'|'+k.rel)).map((k)=>k.rel);if(!ask.length)return;
  let r;try{r=await api('/admin/api/files/sizes',{method:'POST',body:{root,paths:ask}});}catch{return;}
  for(const [rel,v] of Object.entries(r.sizes))fbSizes.set(root+'|'+rel,v);if(root===fb.root&&fbTreeOn())fbTreeDraw();}
// The open folder and every folder above it are expanded; the shown folder's own children come from its listing.
async function fbTreeSync(){if(!fbTreeOn()||!fb.root)return;
  if(fbTree.root!==fb.root){fbTree.root=fb.root;fbTree.open=new Set(['']);fbTree.kids.clear();}
  const d=fb.data;if(d&&d.path===fb.path&&d.items.filter((i)=>i.type==='dir').length>=d.counts.dirs)
    {const list=d.items.filter((i)=>i.type==='dir').map((i)=>({rel:i.rel,name:i.title||i.name}));fbTree.kids.set(fb.path,list);fbTreeLeaves(list);}
  let at='';for(const p of fb.path?fb.path.split('/'):[]){at=at?at+'/'+p:p;fbTree.open.add(at);}
  for(const rel of fbTree.open)if(!fbTree.kids.has(rel))await fbTreeKids(rel).catch(()=>fbTree.open.delete(rel));
  fbTreeDraw();}
function fbTreeNode(rel,name){const li=el('li');li.setAttribute('role','treeitem');
  const row=el('div',null,'fb-tn');const open=fbTree.open.has(rel);const kids=fbTree.kids.get(rel);
  row.setAttribute('aria-expanded',String(open));if(rel===fb.path)row.setAttribute('aria-current','page');
  const tx=el('button',null,'fb-tx');tx.type='button';tx.innerHTML=FB_ICON.chev;tx.setAttribute('aria-label',topText(open?'fb.tree.close':'fb.tree.open'));
  // A folder known to hold no folder keeps the arrow's space, so the names stay in one column.
  if((kids&&!kids.length)||fbSizes.get(fb.root+'|'+rel)?.dirs===0)tx.style.visibility='hidden';
  tx.addEventListener('click',async()=>{if(fbTree.open.has(rel)){fbTree.open.delete(rel);fbTreeDraw();return;}
    fbTree.open.add(rel);await fbTreeKids(rel).catch(()=>fbTree.open.delete(rel));fbTreeDraw();});
  const lb=el('button',name,'fb-tl');lb.type='button';lb.title=name;lb.addEventListener('click',()=>fbGo(fb.root,rel));
  // A folder in the tree takes a drop as a folder in the list does, but not one going into itself or staying put.
  fbDropTarget(lb,()=>rel!==fb.path&&!fb.drag?.some((d)=>rel===d||rel.startsWith(d+'/'))&&rel);
  row.append(tx,lb);li.append(row);
  if(open&&kids?.length){const ul=el('ul');ul.setAttribute('role','group');ul.append(...kids.map((k)=>fbTreeNode(k.rel,k.name)));li.append(ul);}
  return li;}
function fbTreeDraw(){const t=$('fb-tree');const ul=el('ul');ul.setAttribute('role','tree');ul.setAttribute('aria-label',topText('fb.tree'));
  ul.append(fbTreeNode('',fbRootName(fb.root)));t.replaceChildren(ul);}

// ── the panes' switches, kept per browser ───────────────────────────
function fbPane(name,on){$('fb').classList.toggle(name+'-on',on);$('fb-t-'+name).setAttribute('aria-pressed',String(on));
  try{localStorage.setItem('fb.'+name,on?'1':'0');}catch{}
  if(on&&name==='tree')fbTreeSync();if(on&&name==='side')fbSide();}
for(const name of ['tree','side']){const b=$('fb-t-'+name);
  b.addEventListener('click',()=>fbPane(name,!$('fb').classList.contains(name+'-on')));
  let v=null;try{v=localStorage.getItem('fb.'+name);}catch{}
  // Both panes start open on a wide screen; a pick is remembered either way.
  fbPane(name,v==null?window.innerWidth>=1400:v==='1');}

// ── more rows as the list scrolls ───────────────────────────────────
async function fbMore(){const d=fb.data;if(!d||fb.moreBusy||d.page>=d.pages)return;fb.moreBusy=true;const n=fb.seq;
  const qs=new URLSearchParams({root:fb.root,path:fb.path,page:String(d.page+1),perPage:String(FB_PER),sort:fb.sort,order:fb.order});
  if(fb.q)qs.set('q',fb.q);if(fb.q&&fb.deep)qs.set('deep','1');
  let ok=false;
  try{const next=await api('/admin/api/files/list?'+qs);if(n!==fb.seq||fb.data!==d)return;ok=true;
    const have=new Set(d.items.map((f)=>f.rel));const add=next.items.filter((f)=>!have.has(f.rel));
    d.items.push(...add);d.page=next.page;d.pages=next.pages;$('fb-rows').append(...add.map(fbRow));fbFoot();fbThumbs();fbSizeRows(add);}
  catch(err){toast(err.message);}
  finally{fb.moreBusy=false;}
  if(ok&&fbMoreSeen)fbMore();}
let fbMoreSeen=false;
// The list scrolls inside the window on a wide screen and with the page on a narrow one.
const fbWindow=matchMedia('(min-width:900px)');
new IntersectionObserver((es)=>{fbMoreSeen=es.some((e)=>e.isIntersecting);if(fbMoreSeen)fbMore();},{root:fbWindow.matches?$('fb-main'):null,rootMargin:'600px 0px'}).observe($('fb-more'));
// The window ends at the bottom of the screen: its height is the screen less where it starts on the page and
// less what the page puts under it, both measured, so the page itself never scrolls.
// What is under it is counted element by element: the page's own height is the screen's at least, so measuring
// from it would keep whatever gap the last fit left.
// Measured only while it shows: a hidden explorer sits at the top with the other tabs' panels counted below it.
function fbFit(){const f=$('fb');if(!f.offsetParent)return;const top=f.getBoundingClientRect().top+window.scrollY;
  const wrap=f.closest('.wrap');let below=wrap?parseFloat(getComputedStyle(wrap).paddingBottom)||0:0;
  for(let n=f;n&&n!==wrap;n=n.parentElement)for(let s=n.nextElementSibling;s;s=s.nextElementSibling)if(s.offsetParent)below+=s.offsetHeight;
  f.style.setProperty('--fb-top',Math.round(top)+'px');f.style.setProperty('--fb-below',Math.ceil(below)+'px');}
window.addEventListener('resize',fbFit);{const fit=new ResizeObserver(fbFit);fit.observe(document.body);fit.observe($('fb'));}fbFit();

// ── folder sizes, from the server's cache (library/folder-sizes.js) ─
// A size seen once shows at once when the folder lists again, and is then brought up to date.
const fbSizes=new Map();
function fbDirSize(f){const s=fbSizes.get(fb.root+'|'+f.rel);if(s)f.holds=s;return s?fbSize(s.bytes):'';}
async function fbSizeRows(items){const dirs=items.filter((f)=>f.type==='dir');if(!dirs.length)return;const root=fb.root;
  let r;try{r=await api('/admin/api/files/sizes',{method:'POST',body:{root,paths:dirs.map((f)=>f.rel)}});}catch{return;}
  if(root!==fb.root)return;
  for(const f of dirs){const s=r.sizes[f.rel];if(!s)continue;fbSizes.set(root+'|'+f.rel,s);f.holds=s;
    for(const tr of document.querySelectorAll('#fb-rows tr'))if(tr.dataset.rel===f.rel){const c=tr.querySelector('.c-size');
      c.textContent=fbSize(s.bytes);c.title=topFill('fb.p.holdsVal',{files:num(s.files),dirs:num(s.dirs)});}}
  if(fb.sel.size===1&&dirs.some((f)=>fb.sel.has(f.rel)))fbSide();}

// ── a copy's progress ───────────────────────────────────────────────
const FB_JOB_MS=700;
async function fbCopyRun(body){const start=await api('/admin/api/files/copy',{method:'POST',body:{...body,background:true}});
  const box=$('fb-job');const bar=box.querySelector('progress');const txt=box.querySelector('span');box.hidden=false;
  try{for(;;){const j=await api('/admin/api/files/copy/'+start.job);
      const p=j.total?Math.floor(j.done*100/j.total):100;bar.max=100;bar.value=p;
      txt.textContent=topFill('fb.copyProg',{done:fbSize(j.done),total:fbSize(j.total),p:num(p)});
      if(j.state==='done')return j;if(j.state==='failed')throw new Error(j.error);
      await new Promise((ok)=>setTimeout(ok,FB_JOB_MS));}}
  finally{box.hidden=true;}}
`;
