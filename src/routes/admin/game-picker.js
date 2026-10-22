// One search picker for the "find a game" fields on the admin page (a game's name and description,
// the upload's game, moving a patch). It asks the server as the admin types
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
.gp-list .gp-tag.gp-own{color:var(--muted)}
.gp-list .gp-note{padding:8px 9px;color:var(--muted);font-size:13px}
.gp-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

export const GAME_PICKER_SCRIPT = /* js */ `
const GP_LIMIT=20,GP_WAIT=150;let gpSeq=0,gpPlace=null;
// A field holding a picked game: "name [title id]".
const GP_FILLED=/\\[[0-9A-Fa-f]{16}\\]\\s*$/;
// Only the open list follows the page; one pair of listeners serves every picker.
addEventListener('resize',()=>gpPlace?.());addEventListener('scroll',()=>gpPlace?.(),true);
// pick(game) runs on a click or Enter; added(titleId) marks games already there, which are not picked again.
// fill puts "name [title id]" in the field, for forms that read the id from it; edited marks the games
// the admin wrote about.
function gamePicker(input,{pick,added=()=>false,fill=false,edited=false}){
  // A popover sits in the top layer: above an open dialog, clear of any parent that clips or scrolls,
  // and out of the layout, so opening it never moves the buttons next to the field.
  const list=el('ul',null,'gp-list');list.id='gp-'+(++gpSeq);list.setAttribute('role','listbox');
  const pop=typeof list.showPopover==='function';if(pop)list.popover='manual';else list.hidden=true;
  // What a screen reader is told that is not an option: nothing matched, or how many more there are.
  const live=el('div',null,'gp-live');live.setAttribute('role','status');live.setAttribute('aria-live','polite');
  // Outside the field's label, so neither the options nor the status become part of the field's name.
  const label=input.labels?.[0];(label??input).after(list,live);input.removeAttribute('list');input.autocomplete='off';
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  // The list is named after its field: the field's label, else its aria-label (read when it opens, so a new language shows).
  const caption=label?.querySelector('[data-top]')??label;if(caption){caption.id||=list.id+'-label';list.setAttribute('aria-labelledby',caption.id);}
  let items=[],active=-1,timer=0,asked=0,filled=GP_FILLED.test(input.value)?input.value:null,open=false,composing=false;
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
    if(on){if(!label)list.setAttribute('aria-label',input.getAttribute('aria-label')||'');gpPlace=place;place();}
    else{if(gpPlace===place)gpPlace=null;input.removeAttribute('aria-activedescendant');live.textContent='';}};
  const mark=(i)=>{active=i;const opts=list.querySelectorAll('[role=option]');
    opts.forEach((o,j)=>o.setAttribute('aria-selected',String(j===i)));
    const o=opts[i];if(o){input.setAttribute('aria-activedescendant',o.id);
      if(o.offsetTop<list.scrollTop)list.scrollTop=o.offsetTop;else if(o.offsetTop+o.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=o.offsetTop+o.offsetHeight-list.clientHeight;}else input.removeAttribute('aria-activedescendant');};
  const choose=(i)=>{const g=items[i];if(!g)return;
    if(added(g.titleId)){toast(topText('gp.already'));return;}
    if(fill){input.value=g.name+' ['+g.titleId+']';filled=input.value;}else input.value='';
    show(false);pick(g);};
  const note=(text)=>{const li=el('li',text,'gp-note');li.setAttribute('role','presentation');list.append(li);live.textContent=text;};
  // current: the field already holds this game, so it is shown as the value, not offered for Enter.
  function draw(d,{query,current}){
    // Halfway through a Korean syllable, an empty answer is a step on the way: the last list stays.
    if(composing&&!d.items.length&&items.length&&open)return;
    items=d.items;list.replaceChildren();live.textContent='';
    items.forEach((g,i)=>{const o=el('li');o.id=list.id+'-'+i;o.setAttribute('role','option');
      const has=added(g.titleId);if(has)o.setAttribute('aria-disabled','true');
      const img=el('img');img.src='/api/shop/icon/'+g.titleId+'?size=sm';img.alt='';img.loading='lazy';img.onerror=()=>{img.style.visibility='hidden';};
      const t=el('span',null,'gp-t');t.append(el('span',g.name||g.titleId,'gp-n'),el('span',(g.matched?g.matched+' · ':'')+g.titleId,'gp-s'));
      o.append(img,t);
      if(has)o.append(el('span',topText('gp.added'),'gp-tag'));
      else if(current)o.append(el('span',topText('gp.current'),'gp-tag'));
      if(edited&&g.edited)o.append(el('span',topText('gp.edited'),'gp-tag gp-own'));
      o.addEventListener('mousedown',(e)=>e.preventDefault());o.addEventListener('click',()=>choose(i));
      o.addEventListener('mousemove',()=>{if(active!==i)mark(i);});list.append(o);});
    if(!items.length)note(topText('gp.none'));
    else if(d.total>items.length)note(topText('gp.more').replace('{n}',String(d.total-items.length)));
    show(true);
    // Enter picks only after something was typed: an empty field, or one showing its own value, arms nothing.
    mark(query&&!current?items.findIndex((g)=>!added(g.titleId)):-1);}
  async function ask(){const n=++asked,query=input.value.trim(),current=GP_FILLED.test(query);
    let d;try{d=await api('/admin/api/games/search?limit='+GP_LIMIT+'&q='+encodeURIComponent(query));}
    catch(err){if(n===asked)toast(err.message);return;}
    if(n===asked&&document.activeElement===input)draw(d,{query,current});}
  const soon=()=>{clearTimeout(timer);timer=setTimeout(ask,GP_WAIT);};
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;if(input.value!==filled)soon();});
  input.addEventListener('input',()=>{if(input.value===filled)return;filled=null;soon();});
  // A field filled by code ("name [title id]") shows that game; a picked value right after picking shows nothing.
  input.addEventListener('focus',()=>{if(input.value!==filled)soon();});
  input.addEventListener('blur',()=>{clearTimeout(timer);asked++;composing=false;show(false);});
  input.addEventListener('keydown',(e)=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open){ask();return;}
      if(!items.length)return;const step=e.key==='ArrowDown'?1:-1;mark(active<0&&step<0?items.length-1:(active+step+items.length)%items.length);}
    else if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){if(open&&items[active]){e.preventDefault();choose(active);}else if(open)e.preventDefault();}
    else if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();show(false);}});
  return input;}
`;
