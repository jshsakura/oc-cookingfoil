// One search picker for every "find a game" field on the admin page (home picks, a game's name and
// description, the upload's game, moving a patch). It asks the server as the admin types
// (/admin/api/games/search) instead of handing the browser a list of the whole library.

export const GAME_PICKER_CSS = /* css */ `
.gp-list{position:fixed;inset:auto;z-index:80;margin:0;padding:6px;color:var(--text);list-style:none;overflow-y:auto;overscroll-behavior:contain;
  background:var(--panel);border:1px solid var(--line2);border-radius:14px;box-shadow:0 16px 36px var(--shadow)}
.gp-list[hidden]{display:none}
.gp-list li[role=option]{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:10px;cursor:pointer;min-width:0}
.gp-list li[role=option][aria-selected="true"]{background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line2)}
.gp-list li[role=option][aria-disabled="true"]{cursor:default;opacity:.6}
.gp-list img{width:36px;height:36px;border-radius:9px;flex:none;background:var(--line);object-fit:cover}
.gp-list .gp-t{flex:1;min-width:0;display:grid;gap:1px}
.gp-list .gp-n,.gp-list .gp-s{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-list .gp-n{font-weight:600}
.gp-list .gp-s{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.gp-list .gp-tag{flex:none;font-size:12px;font-weight:700;color:var(--good)}
.gp-list .gp-note{padding:8px 9px;color:var(--muted);font-size:13px}
`;

export const GAME_PICKER_SCRIPT = /* js */ `
const GP_LIMIT=20,GP_WAIT=150;let gpSeq=0,gpPlace=null;
// Only the open list follows the page; one pair of listeners serves every picker.
addEventListener('resize',()=>gpPlace?.());addEventListener('scroll',()=>gpPlace?.(),true);
// pick(game) runs on a click or Enter; added(titleId) marks games already there, which are not picked again.
// fill puts "name [title id]" in the field, for forms that read the id from it.
function gamePicker(input,{pick,added=()=>false,fill=false}){
  // A popover sits in the top layer: above an open dialog, clear of any parent that clips or scrolls,
  // and out of the layout, so opening it never moves the buttons next to the field.
  const list=el('ul',null,'gp-list');list.id='gp-'+(++gpSeq);list.setAttribute('role','listbox');
  const pop=typeof list.showPopover==='function';if(pop)list.popover='manual';else list.hidden=true;
  input.after(list);input.removeAttribute('list');input.autocomplete='off';
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  let items=[],active=-1,timer=0,asked=0,filled=null,open=false;
  // Under the field, or above it when there is more room there; as wide as the field and inside the window.
  const place=()=>{if(!open)return;const r=input.getBoundingClientRect(),gap=4,edge=8;
    const width=Math.min(r.width,innerWidth-2*edge);
    list.style.width=width+'px';list.style.left=Math.min(Math.max(edge,r.left),innerWidth-edge-width)+'px';
    list.style.maxHeight='';const need=Math.min(360,list.scrollHeight);
    const below=innerHeight-r.bottom-gap-edge,above=r.top-gap-edge,up=need>below&&above>below;
    list.style.maxHeight=Math.max(120,Math.min(360,up?above:below))+'px';
    list.style.top=(up?r.top-gap-list.offsetHeight:r.bottom+gap)+'px';};
  const show=(on)=>{if(on!==open){open=on;
      if(!pop)list.hidden=!on;else if(list.isConnected)list[on?'showPopover':'hidePopover']();}
    input.setAttribute('aria-expanded',String(on));
    if(on){gpPlace=place;place();}else{if(gpPlace===place)gpPlace=null;input.removeAttribute('aria-activedescendant');}};
  const mark=(i)=>{active=i;const opts=list.querySelectorAll('[role=option]');
    opts.forEach((o,j)=>o.setAttribute('aria-selected',String(j===i)));
    const o=opts[i];if(o){input.setAttribute('aria-activedescendant',o.id);
      if(o.offsetTop<list.scrollTop)list.scrollTop=o.offsetTop;else if(o.offsetTop+o.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=o.offsetTop+o.offsetHeight-list.clientHeight;}else input.removeAttribute('aria-activedescendant');};
  const choose=(i)=>{const g=items[i];if(!g)return;
    if(added(g.titleId)){toast(topText('gp.already'));return;}
    if(fill){input.value=g.name+' ['+g.titleId+']';filled=input.value;}else input.value='';
    show(false);pick(g);};
  function draw(d){items=d.items;list.replaceChildren();
    items.forEach((g,i)=>{const o=el('li');o.id=list.id+'-'+i;o.setAttribute('role','option');
      const has=added(g.titleId);if(has)o.setAttribute('aria-disabled','true');
      const img=el('img');img.src='/api/shop/icon/'+g.titleId+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      const t=el('span',null,'gp-t');t.append(el('span',g.name||g.titleId,'gp-n'),el('span',(g.matched?g.matched+' · ':'')+g.titleId,'gp-s'));
      o.append(img,t);if(has)o.append(el('span',topText('gp.added'),'gp-tag'));
      o.addEventListener('mousedown',(e)=>e.preventDefault());o.addEventListener('click',()=>choose(i));
      o.addEventListener('mousemove',()=>{if(active!==i)mark(i);});list.append(o);});
    if(!items.length)list.append(el('li',topText('gp.none'),'gp-note'));
    else if(d.total>items.length)list.append(el('li',topText('gp.more').replace('{n}',String(d.total-items.length)),'gp-note'));
    show(true);mark(items.findIndex((g)=>!added(g.titleId)));}
  async function ask(){const n=++asked;
    let d;try{d=await api('/admin/api/games/search?limit='+GP_LIMIT+'&q='+encodeURIComponent(input.value.trim()));}
    catch(err){if(n===asked)toast(err.message);return;}
    if(n===asked&&document.activeElement===input)draw(d);}
  const soon=()=>{clearTimeout(timer);timer=setTimeout(ask,GP_WAIT);};
  input.addEventListener('input',()=>{if(input.value===filled)return;filled=null;soon();});
  input.addEventListener('focus',()=>{if(input.value!==filled)soon();});
  input.addEventListener('blur',()=>{clearTimeout(timer);asked++;show(false);});
  input.addEventListener('keydown',(e)=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open){ask();return;}
      if(!items.length)return;const step=e.key==='ArrowDown'?1:-1;mark((active+step+items.length)%items.length);}
    else if(e.key==='Enter'&&!e.isComposing){if(open&&items[active]){e.preventDefault();choose(active);}else if(open)e.preventDefault();}
    else if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();show(false);}});
  return input;}
`;
