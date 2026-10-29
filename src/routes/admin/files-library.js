/**
 * The file browser's library side (files-panel.js): what the server knows about each entry
 * (library/file-facts.js) shown on its row, a folder tree on the left, a details pane on the right,
 * rows that keep coming as the list scrolls, and a copy's progress while it runs.
 */
export const LIBRARY_CSS = /* css */ `
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
#fb .fb-badge{flex:0 0 auto;padding:1px 7px;border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:var(--fw-bold);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
#fb .fb-badge[data-tone="warn"]{color:var(--warn);border-color:currentColor}
#fb .fb-badge[data-tone="bad"]{color:var(--bad);border-color:currentColor}
#fb .fb-side .fb-s-head{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
#fb .fb-side .fb-s-art{width:96px;height:96px;border-radius:var(--r-lg);object-fit:cover;background:var(--sunk)}
#fb .fb-side .fb-s-art.ico{padding:24px;color:var(--muted)}
#fb .fb-side h4{margin:0;font-size:var(--fs-md);overflow-wrap:anywhere}
#fb .fb-side .fb-s-sub{font-size:var(--fs-xs);color:var(--faint);overflow-wrap:anywhere}
#fb .fb-side .fb-s-badges{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}
#fb .fb-side dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:0;font-size:var(--fs-sm)}
#fb .fb-side dt{color:var(--muted)}#fb .fb-side dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
#fb .fb-side .fb-s-act{display:flex;justify-content:center;gap:6px}
#fb .fb-side .fb-s-act .ib{width:38px;height:38px;padding:0;display:inline-grid;place-items:center}
#fb .fb-side .fb-s-act .ib .ico{width:18px;height:18px}
#fb .fb-side .fb-s-links:empty{display:none}
#fb .fb-side .fb-s-link{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 10px;border-radius:var(--r-md);background:var(--sunk);font-size:var(--fs-sm)}
#fb .fb-side .fb-s-link+.fb-s-link{margin-top:4px}
#fb .fb-side .fb-s-link .ib{width:28px;height:28px;padding:0;display:inline-grid;place-items:center}
#fb .fb-side .fb-s-link .ib .ico{width:14px;height:14px}
#fb .fb-side .fb-s-none{color:var(--muted);font-size:var(--fs-sm);text-align:center;margin:24px 0}
#fb .fb-more{height:1px}
/* With the details pane open its buttons stand in for the row's, which leaves the names their room. */
#fb.side-on .c-act{display:none}
#fb .fb-job{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
#fb .fb-job[hidden]{display:none}
#fb .fb-job progress{width:160px}
@media (max-width:899px){#fb.tree-on .fb-tree,#fb.side-on .fb-side{display:none}}
/* From tablet width up the browser is one window, as on a desktop: the toolbar on top, the tree, the list and the
   details side by side, each scrolling on its own, and the status bar at the bottom, the whole filling the screen. */
@media (min-width:900px){
  .adm-shell>.wrap:has(#fb){max-width:none}
  #fb{gap:0;height:calc(100dvh - var(--fb-top,220px) - var(--fb-below,24px));min-height:320px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--panel);overflow:hidden}
  #fb .fb-bar{padding:10px 12px;border-bottom:1px solid var(--line)}
  #fb .fb-body{flex:1 1 auto;min-height:0;grid-template-rows:minmax(0,1fr);align-items:stretch}
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
  if(f.check)out.push(fbBadge(topText('fb.c.'+f.check),'bad'));
  return out;}
// The game's icon in place of the folder or file icon; the plain icon comes back when there is none yet.
function fbGameIcon(f,size,cls){const img=el('img');img.className=cls;img.alt='';img.loading='lazy';img.decoding='async';img.src=fbIconUrl(f.titleId,size);return img;}
function fbDecorate(n,f){if(f.titleId){const ic=n.querySelector('.ico');if(ic){const img=fbGameIcon(f,'md','fb-gicon');img.addEventListener('error',()=>img.replaceWith(ic),{once:true});ic.replaceWith(img);}}
  for(const b of fbBadges(f))n.append(b);}

// ── the details pane ────────────────────────────────────────────────
function fbSideOn(){return $('fb').classList.contains('side-on');}
function fbSide(){if(!fbSideOn())return;const s=$('fb-side');const items=[...fb.sel].map(fbItem).filter(Boolean);
  if(items.length===1)return fbSideOne(s,items[0]);
  if(items.length>1){const files=items.filter((f)=>f.type==='file');
    s.replaceChildren(el('h4',topFill('fb.selected',{n:num(items.length)})),el('p',topFill('fb.side.files',{n:num(files.length),size:fbSize(files.reduce((a,f)=>a+(f.size||0),0))}),'fb-s-sub'));return;}
  s.replaceChildren(el('p',topText('fb.side.none'),'fb-s-none'));}
function fbSideOne(s,f){const head=el('div',null,'fb-s-head');
  if(f.titleId){const img=fbGameIcon(f,'md','fb-s-art');img.addEventListener('error',()=>img.replaceWith(fbSideIcon(f)),{once:true});head.append(img);}else head.append(fbSideIcon(f));
  head.append(el('h4',f.title||f.name));if(f.title)head.append(el('div',f.name,'fb-s-sub'));
  const badges=fbBadges(f);if(badges.length){const b=el('div',null,'fb-s-badges');b.append(...badges);head.append(b);}
  const rows=[];
  if(f.titleId)rows.push(['fb.p.titleId',f.titleId]);
  if(f.version!=null)rows.push(['fb.p.version','v'+f.version]);
  if(f.check)rows.push(['fb.p.check',topText('fb.c.'+f.check)]);
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
  // The actions are a row of icons under the name; their words are in the tooltip and for screen readers.
  const act=el('div',null,'fb-s-act');
  act.append(fbSideBtn(FB_ICON.download,f.type==='dir'?'fb.zip':'fb.download',()=>f.type==='dir'?fbZip([f.rel]):fbDownload(f)));
  const links=el('div',null,'fb-s-links');
  if(f.type==='file'){act.append(fbSideBtn(FB_ICON.share,'fb.share',()=>fbShare(f,links)));fbShareList(f,links);}
  act.append(fbSideBtn(FB_ICON.rename,'fb.rename',()=>fbRename(f)),fbSideBtn(FB_ICON.trash,'fb.trash',()=>fbTrash([f.rel]),'danger'));
  s.replaceChildren(head,act,links,dl);}

// ── share links: one file, anyone with the link, for a while (library/file-shares.js) ─
async function fbShare(f,links){const root=fb.root;
  const hours=await askPick(topText('fb.shareAsk'),[['1','fb.share1h'],['24','fb.share1d'],['168','fb.share7d']].map(([value,k])=>({value,label:topText(k)})));
  if(!hours)return;
  let r;try{r=await api('/admin/api/files/share',{method:'POST',body:{root,path:f.rel,hours:Number(hours)}});}catch(err){toast(err.message);return;}
  const when=fbDate(r.expiresAt);
  // Over plain http the browser keeps the clipboard shut; the link is then shown to copy by hand.
  try{await navigator.clipboard.writeText(r.url);toast(topFill('fb.shareCopied',{when}));}
  catch{await askDialog(topFill('fb.shareCopy',{when}),r.url);}
  if(root===fb.root&&links.isConnected)fbShareList(f,links);}
async function fbShareList(f,links){const root=fb.root;let r;
  try{r=await api('/admin/api/files/shares?'+new URLSearchParams({root,path:f.rel}));}catch{return;}
  if(!links.isConnected)return;
  links.replaceChildren(...r.shares.map((sh)=>{const row=el('div',null,'fb-s-link');row.append(el('span',topFill('fb.shareUntil',{when:fbDate(sh.expiresAt)})));
    const end=fbSideBtn(FB_ICON.stop,'fb.shareEnd',async()=>{try{await api('/admin/api/files/share/end',{method:'POST',body:{id:sh.id}});toast(topText('fb.shareEnded'));}
      catch(err){toast(err.message);}fbShareList(f,links);},'danger');row.append(end);return row;}));}
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
function fbFit(){const f=$('fb');if(!f.isConnected)return;const top=f.getBoundingClientRect().top+window.scrollY;
  const below=Math.max(0,document.scrollingElement.scrollHeight-(top+f.offsetHeight));
  f.style.setProperty('--fb-top',Math.round(top)+'px');f.style.setProperty('--fb-below',Math.ceil(below)+'px');}
window.addEventListener('resize',fbFit);new ResizeObserver(fbFit).observe(document.body);fbFit();

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
