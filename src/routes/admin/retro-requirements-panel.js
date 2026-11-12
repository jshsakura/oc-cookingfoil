/**
 * 시스템 › 필수 파일: what the retro games in the library still need, read from /admin/api/retro/requirements.
 * The BIOS the operator puts in show as chips, grey while missing, green once there, amber when the md5 differs;
 * each system's core is a quiet line, since the server supplies cores. Systems still missing something come
 * first; complete ones fold away. RQ_SCRIPT's helpers are shared with the retro art view (retro-art-panel.js).
 */
import { RQ_WORDS } from "./retro-requirements-words.js";

export const RQ_CSS = /* css */ `
#rq-page{display:grid;gap:8px}#rq-page p{margin:0}
.rq-note{font-size:var(--fs-xs)}
.rq-ok{color:var(--good);font-weight:var(--fw-bold);font-size:var(--fs-sm)}
.rq-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.rq-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:10px 12px;display:grid;gap:6px;align-content:start}
.rq-card.need,.rq-card.check{border-color:rgba(var(--warn-rgb),.45)}
.rq-tag{margin-left:auto;font-size:var(--fs-2xs);font-weight:var(--fw-bold);color:var(--warn)}
.rq-card h4{margin:0;font-size:var(--fs-sm);display:flex;gap:8px;align-items:baseline}.rq-card h4 span{color:var(--muted);font-weight:400;font-size:var(--fs-xs)}
.rq-core{color:var(--muted);font-size:var(--fs-xs);overflow-wrap:anywhere}.rq-core code{font-size:var(--fs-2xs)}
.rq-chips{display:flex;flex-wrap:wrap;gap:5px}
.rq-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 9px;border-radius:var(--r-pill);font-size:var(--fs-xs);line-height:1.6;border:1px solid var(--line);background:var(--sunk);color:var(--muted);overflow-wrap:anywhere}
.rq-chip.present{color:var(--good);border-color:rgba(var(--good-rgb),.5);background:rgba(var(--good-rgb),.12)}
.rq-chip.mismatch{color:var(--warn);border-color:rgba(var(--warn-rgb),.6);background:rgba(var(--warn-rgb),.12)}
.rq-chip .rq-ic{font-weight:700}.rq-chip .rq-opt{font-size:var(--fs-2xs);opacity:.85;border:1px solid currentColor;border-radius:var(--r-pill);padding:0 5px}
.rq-hint{color:var(--muted);font-size:var(--fs-xs)}
.rq-done summary{cursor:pointer;color:var(--good);font-weight:var(--fw-bold);font-size:var(--fs-sm)}.rq-done .rq-cards{margin-top:8px}
`;

export const RQ_SCRIPT = /* js */ `
// What the games in the library still need (GET /admin/api/retro-art requirements): the BIOS the operator puts in
// as chips, grey while missing, green once there, amber when the md5 differs; each system's core as a quiet line,
// since the server supplies cores. Systems still missing something come first; complete ones fold away.
// A folder under roms/ that no system reads would hide its games without a word.
const rqWords=${JSON.stringify(RQ_WORDS)};
const rqT=(k,v)=>{let s=(rqWords[adminLang]||rqWords.ko)[k]??rqWords.ko[k]??k;if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const rqHas=(k)=>Object.hasOwn(rqWords.ko,k);
// A core state or reason the pack adds later still reads as words, never as a key.
const rqCs=(state)=>rqHas('cs.'+state)?rqT('cs.'+state):rqT('cs.unknown',{state:String(state)});
const rqReason=(code)=>!code?'':rqHas('reason.'+code)?rqT('reason.'+code):rqT('reason.other');
const rqName=(s)=>s.names[adminLang]||s.names.en||s.id;
const rqBase=(f)=>f.slice(f.lastIndexOf('/')+1);
function rqChip(label,state,opts={}){const c=el('span',null,'rq-chip '+state);c.dataset.state=state;
  c.append(el('span',state==='present'?'\u2713':state==='mismatch'?'!':'\u25CB','rq-ic'),el('span',label));
  if(opts.optional)c.append(el('span',rqT('opt'),'rq-opt'));
  c.title=[rqT('st.'+state),...(opts.notes||[])].join('\\n');c.setAttribute('aria-label',label+', '+rqT('st.'+state)+(opts.optional?', '+rqT('opt'):''));return c;}
function rqFirmwareChip(f){const n=f.files.length;
  const label=f.recognizedAs?rqBase(f.recognizedAs):f.file?rqBase(f.file):n>2?rqBase(f.files[0])+' / +'+(n-1):f.files.map(rqBase).join(' / ');
  const notes=[];if(f.recognizedAs)notes.push(rqT('recognized',{file:f.file,as:f.recognizedAs}));
  if(f.state==='mismatch')notes.push(rqT('mismatch',{file:f.file}));if(f.state==='missing'&&n>1)notes.push(rqT('anyOf',{files:f.files.join(', ')}));
  if(!f.required)notes.push(rqT('optWhy'));return rqChip(label,f.state,{optional:!f.required,notes});}
function rqCard(s){const card=el('div',null,'rq-card'+(s.missing?' need':s.check?' check':''));card.dataset.system=s.id;
  const h=el('h4',rqName(s));h.append(el('span',rqT('games',{n:s.games})));
  // Something not there and a file of another dump are told apart: the second may still start.
  if(s.missing||s.check)h.append(el('span',s.missing?rqT('tagMissing',{n:s.missing}):rqT('tagCheck'),'rq-tag'));card.append(h);
  for(const c of s.cores){const line=el('div',null,'rq-core');line.append(rqT('core',{file:''}),el('code',c.file),' \u00B7 '+rqCs(c.state));card.append(line);}
  const chips=el('div',null,'rq-chips');chips.append(...s.firmware.map(rqFirmwareChip));
  if(s.arcade){chips.append(...s.arcade.bios.map((b)=>rqChip(b.zip,b.state,{notes:[rqT('games',{n:b.sets})]})));
    if(s.arcade.parents.length)chips.append(rqChip(rqT('parents',{n:s.arcade.parents.length}),'missing',{notes:[s.arcade.parents.slice(0,20).map((p)=>p.zip).join(', ')]}));}
  if(chips.childElementCount)card.append(chips);
  if(s.missing||s.check){const fw=s.firmware.some((f)=>f.required&&f.state==='missing'),arc=s.arcade&&(s.arcade.parents.length||s.arcade.bios.some((b)=>b.state==='missing'));
    const mm=s.firmware.some((f)=>f.required&&f.state==='mismatch');
    card.append(el('p',[fw?rqT('hintFw'):'',arc?rqT('hintArc'):'',mm?rqT('hintMd5'):''].filter(Boolean).join(' '),'rq-hint'));}
  return card;}
const RQ_CORE_WARN={'not-in-bundle':'coreNotInBundle','not-in-nightly':'coreNotInNightly',failed:'coreFailed'};
function rqCoreWarn(s,c){const v={system:rqName(s),n:c.games,file:c.file,reason:rqReason(c.reason)};
  const p=el('p',rqT(RQ_CORE_WARN[c.state]||'coreMissing',v).trim(),'warn-line');if(c.message)p.title=c.message;return p;}
`;

export const RQ_PAGE_HTML = /* html */ `<section id="tab-requirements"><div id="rq-page" data-skel></div></section>`;

export const RQ_PAGE_SCRIPT = /* js */ `
let rqData=null;
function rqRender(req){rqData=req;const systems=req.systems||[];
  const out=[el('p',rqT('nro'),'muted rq-note')];
  if(req.retroarch==='missing')out.push(el('p',rqT('noRa'),'warn-line'));
  for(const s of systems)for(const c of s.cores)if(c.warn)out.push(rqCoreWarn(s,c));
  const need=systems.filter((s)=>s.missing||s.check),done=systems.filter((s)=>!s.missing&&!s.check&&(s.firmware.length||(s.arcade&&s.arcade.bios.length)));
  if(systems.length&&!need.length)out.push(el('p','✓ '+rqT('allOk'),'rq-ok'));
  if(need.length){const box=el('div',null,'rq-cards');box.id='rq-need';box.append(...need.map(rqCard));out.push(box);}
  if(done.length){const d=el('details',null,'rq-done');d.id='rq-done';d.append(el('summary','✓ '+rqT('okList',{n:done.length})));
    const box=el('div',null,'rq-cards');box.append(...done.map(rqCard));d.append(box);out.push(d);}
  const page=$('rq-page');delete page.dataset.skel;page.replaceChildren(...out);}
function rqRelabel(){if(rqData)rqRender(rqData);}
async function loadRequirements(){try{rqRender(await api('/admin/api/retro/requirements'));}catch(err){toast(err.message);}}
`;
