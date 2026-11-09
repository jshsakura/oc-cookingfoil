/**
 * The icon slot of a homebrew app or a patch: its icon now, a button to choose another and a drop target,
 * saved through /api/art/:kind/:id/icon into the item folder's metadata/ (meta/art-sidecar.js), where a
 * picture put by hand is read too. Before this the web page's art editor was the only way in.
 */
import { icon } from "../../views/icons.js";
import { top } from "./top-i18n.js";

/** The slot's markup; picSlot() in the page script binds it to one item when its dialog opens. */
export const picSlotHtml = (id) => /* html */ `<div class="pic-slot" id="${id}">
  <div class="pic-frame">${icon("image")}<img alt="" hidden></div>
  <div class="pic-side"><b>${top("pic.icon")}</b><span class="muted">${top("pic.hint")}</span>
    <div class="pic-acts"><button type="button" data-pic="pick">${top("pic.pick")}</button><button type="button" class="danger" data-pic="remove" hidden>${top("pic.remove")}</button></div>
    <input type="file" accept="image/*" hidden></div></div>`;

export const PIC_SLOT_CSS = /* css */ `
.pic-slot{display:flex;gap:14px;align-items:center;padding:12px;margin:0 0 14px;border:1px dashed var(--line2);border-radius:var(--r-xl);background:var(--panel)}
.pic-slot.over{border-color:var(--text);background:var(--sunk)}
.pic-slot.busy{opacity:.6;pointer-events:none}
.pic-frame{flex:none;display:grid;place-items:center;width:88px;height:88px;border-radius:var(--r-lg);background:var(--sunk);overflow:hidden;color:var(--faint)}
.pic-frame .ico{width:32px;height:32px}
.pic-frame img{width:100%;height:100%;object-fit:cover}
.pic-slot.has .pic-frame .ico{display:none}
.pic-side{display:grid;gap:4px;min-width:0}
.pic-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
`;

export const PIC_SLOT_SCRIPT = /* js */ `
const picBound=new WeakSet();
const picBase=(box)=>'/api/art/'+box.dataset.kind+'/'+encodeURIComponent(box.dataset.id);
async function picShow(box){const img=box.querySelector('img'),rm=box.querySelector('[data-pic="remove"]');
  let d=null;try{d=await api(picBase(box));}catch{}
  const url=d&&d.icon;img.hidden=!url;rm.hidden=!url;box.classList.toggle('has',Boolean(url));
  img.alt=url?'':topText('pic.none');
  if(url)img.src=url+(url.includes('?')?'&':'?')+'t='+Date.now();else img.removeAttribute('src');}
async function picSend(box,file){if(!file)return;
  if(!/^image[/]/.test(file.type)){toast(topText('pic.notImage'));return;}
  const fd=new FormData();fd.append('file',file);box.classList.add('busy');
  try{const r=await fetch(picBase(box)+'/icon',{method:'POST',body:fd,headers:{Accept:'application/json','Accept-Language':typeof adminLang==='string'?adminLang:'ko'}});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);toast(topText('pic.saved'));}
  catch(err){toast(err.message);}
  finally{box.classList.remove('busy');picShow(box);}}
// One slot element serves every item its dialog opens: the handlers are bound once and read the item from it.
function picSlot(box,kind,id){if(!box)return;box.dataset.kind=kind;box.dataset.id=id;
  if(!picBound.has(box)){picBound.add(box);const input=box.querySelector('input[type=file]');
    box.querySelector('[data-pic="pick"]').addEventListener('click',()=>input.click());
    input.addEventListener('change',()=>{picSend(box,input.files[0]);input.value='';});
    box.querySelector('[data-pic="remove"]').addEventListener('click',async()=>{if(!await ask(topText('pic.removeAsk'),{danger:true}))return;
      try{await api(picBase(box)+'/icon',{method:'DELETE'});toast(topText('pic.removed'));}catch(err){toast(err.message);}
      picShow(box);});
    // A drop here is the item's icon, never an upload into the folder the page shows.
    box.addEventListener('dragover',(e)=>{if(![...e.dataTransfer.types].includes('Files'))return;e.preventDefault();e.stopPropagation();box.classList.add('over');});
    box.addEventListener('dragleave',()=>box.classList.remove('over'));
    box.addEventListener('drop',(e)=>{e.preventDefault();e.stopPropagation();box.classList.remove('over');picSend(box,e.dataTransfer.files[0]);});}
  picShow(box);}
`;
