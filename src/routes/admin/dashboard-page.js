/**
 * The operator dashboard.
 *
 * Its job, in order of importance:
 *   1. say out loud when the current auth configuration locks out a client
 *      that the operator thinks should work (the pairing-only / Tinfoil trap)
 *   2. show every refusal the server made, with the reason
 *   3. let devices be approved and IPs unlocked without shell access
 */
import { ADMIN_CSS } from "./styles.js";

export function dashboardPage() {
  return /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil · Admin</title><style>${ADMIN_CSS}
body{padding:28px 20px}.wrap{max-width:980px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
h1{font-size:20px;margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:8px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.card .v{font-size:24px;font-weight:700}
.card .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.card.alert{border-color:rgba(243,139,168,.45)}.card.alert .v{color:var(--bad)}
.lanes{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 4px}
.scroll{overflow-x:auto}
.hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
</style></head><body>
<div class="wrap">
<header><div><h1>🧈 CookingFoil Admin</h1><div class="muted" id="ts">loading…</div></div>
<button id="logout" type="button">Log out</button></header>

<div id="warnings"></div>
<div class="lanes" id="lanes"></div>
<div class="cards" id="cards"></div>

<h2>Users</h2><div id="users"></div>

<div class="hd"><h2>Lockouts</h2></div><div id="lockouts"></div>

<div class="hd"><h2>Access denials</h2><button type="button" id="clrdeny">Clear</button></div>
<div class="muted" style="margin-bottom:8px">Every request the server refused, and why. This is where a client that
"silently fails" shows up.</div>
<div class="scroll" id="denials"></div>

<h2>Devices <span class="muted" id="devhint"></span></h2>
<div id="pending"></div><div style="height:10px"></div><div id="devices"></div>
</div>
<script>
const fmt=t=>t?new Date(t).toLocaleString():'—';
const ago=t=>{if(!t)return '—';const s=Math.round((Date.now()-t)/1000);
 if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';
 if(s<86400)return Math.round(s/3600)+'h ago';return Math.round(s/86400)+'d ago';};
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
function table(head,rows,mount){const m=document.getElementById(mount);m.innerHTML='';
 if(!rows.length){m.appendChild(el('div',head.empty,'empty'));return;}
 const t=el('table');const hr=document.createElement('tr');
 for(const h of head.cols){const th=document.createElement('th');th.textContent=h;hr.appendChild(th);}
 t.appendChild(hr);for(const r of rows)t.appendChild(r);m.appendChild(t);}

function renderWarnings(list){const box=document.getElementById('warnings');box.innerHTML='';
 for(const w of list){const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
  n.appendChild(el('div',(w.severity==='warn'?'⚠️ ':'ℹ️ ')+w.title,'t'));
  n.appendChild(el('div',w.detail,'d'));box.appendChild(n);}}

function renderLanes(l){const box=document.getElementById('lanes');box.innerHTML='';
 const chip=(txt,on)=>el('span',txt,'pill '+(on?'on':'off'));
 box.appendChild(chip('Basic auth: '+(l.basicAuth.enabled?l.basicAuth.userCount+' user(s)':'off'),l.basicAuth.enabled));
 box.appendChild(chip('Device pairing: '+(l.pairing.enabled?'on':'off'),l.pairing.enabled));
 if(l.pairingOnly)box.appendChild(el('span','Content locked to approved devices','pill warn'));
 box.appendChild(chip('Admin 2FA: '+(l.admin.enrolled?'enrolled':'not enrolled'),l.admin.enrolled));}

async function load(){
  const r=await fetch('/admin/api/stats',{headers:{Accept:'application/json'}});
  if(r.status===401){location.reload();return;}
  const d=await r.json();
  document.getElementById('ts').textContent='Updated '+fmt(d.generatedAt);
  renderWarnings(d.warnings||[]);
  renderLanes(d.lanes);

  const cards=document.getElementById('cards');cards.innerHTML='';
  const stat=(l,v,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));
   c.appendChild(el('div',String(v),'v'));c.appendChild(el('div',l,'l'));return c;};
  cards.appendChild(stat('Users',d.totals.configuredUsers));
  cards.appendChild(stat('Requests',d.totals.totalRequests));
  cards.appendChild(stat('Lockouts',d.totals.lockouts,d.totals.lockouts>0));
  cards.appendChild(stat('Denied 24h',d.totals.denied24h,d.totals.denied24h>0));

  table({cols:['User','Status','Last seen','Requests','Last IP'],empty:'No configured users'},
   (d.users||[]).map(u=>{const tr=document.createElement('tr');
    tr.appendChild(el('td',u.user));
    const st=el('td');st.appendChild(el('span',u.lastAt?'active':'never',u.lastAt?'pill on':'pill off'));tr.appendChild(st);
    tr.appendChild(el('td',fmt(u.lastAt)));
    tr.appendChild(el('td',String(u.count||0)));
    const ip=el('td',u.lastIp||'—');ip.className='ip';tr.appendChild(ip);return tr;}),'users');

  table({cols:['IP','Reason','Since','Until',''],empty:'No active lockouts'},
   (d.lockouts||[]).map(l=>{const tr=document.createElement('tr');
    const ip=el('td',l.ip);ip.className='ip';tr.appendChild(ip);
    tr.appendChild(el('td',l.reason||'—'));
    tr.appendChild(el('td',fmt(l.lockedAt)));
    tr.appendChild(el('td',l.until?fmt(l.until):'forever'));
    const act=el('td');const b=el('button','Unlock');
    b.addEventListener('click',()=>unlock(l.ip));act.appendChild(b);tr.appendChild(act);return tr;}),'lockouts');

  table({cols:['When','Reason','Client','Path','IP'],empty:'No denials recorded — everything that asked, got through'},
   (d.denials?.recent||[]).map(x=>{const tr=document.createElement('tr');
    const w=el('td',ago(x.at));w.title=fmt(x.at);tr.appendChild(w);
    const rt=el('td');const p=el('span',x.reason,'pill warn');if(x.hint)p.title=x.hint;rt.appendChild(p);
    if(x.status){rt.appendChild(document.createTextNode(' '));rt.appendChild(el('span',String(x.status),'pill'));}
    if(x.hint)rt.appendChild(el('div',x.hint,'muted'));
    tr.appendChild(rt);
    tr.appendChild(el('td',x.ua||'—'));
    const pa=el('td',x.path||'—');pa.className='ip';tr.appendChild(pa);
    const ip=el('td',x.ip||'—');ip.className='ip';tr.appendChild(ip);return tr;}),'denials');
}

async function loadDevices(){
  const r=await fetch('/admin/api/devices',{headers:{Accept:'application/json'}});
  if(r.status===401){location.reload();return;}
  const d=await r.json();
  document.getElementById('devhint').textContent=d.pairingEnabled?'':'(off — set COOK_DEVICE_PAIRING=true)';

  table({cols:['Pending device key','Seen','Last IP',''],empty:'No devices awaiting approval'},
   (d.pending||[]).map(p=>{const tr=document.createElement('tr');
    const k=el('td',p.deviceKey.slice(0,16)+'…');k.className='ip';k.title=p.deviceKey;tr.appendChild(k);
    tr.appendChild(el('td',fmt(p.lastSeenAt)));
    const ip=el('td',p.lastIp||'—');ip.className='ip';tr.appendChild(ip);
    const act=el('td');const b=el('button','Approve');b.className='primary';
    b.addEventListener('click',()=>approve(p.deviceKey));act.appendChild(b);tr.appendChild(act);return tr;}),'pending');

  table({cols:['Label','Device key','Last seen','Last IP',''],empty:'No approved devices'},
   (d.approved||[]).map(a=>{const tr=document.createElement('tr');
    tr.appendChild(el('td',a.label||'—'));
    const k=el('td',a.deviceKey.slice(0,16)+'…');k.className='ip';k.title=a.deviceKey;tr.appendChild(k);
    tr.appendChild(el('td',fmt(a.lastSeenAt)));
    const ip=el('td',a.lastIp||'—');ip.className='ip';tr.appendChild(ip);
    const act=el('td');
    const ri=el('button','Re-issue');ri.addEventListener('click',()=>reissue(a.deviceKey,a.label));act.appendChild(ri);
    const b=el('button','Revoke');b.style.marginLeft='6px';b.addEventListener('click',()=>revoke(a.deviceKey));act.appendChild(b);
    tr.appendChild(act);return tr;}),'devices');
}

async function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(body||{})});}
async function unlock(ip){if(!confirm('Unlock '+ip+'?'))return;
 const r=await post('/admin/api/unlock',{ip});if(r.ok){load();}else{alert('Unlock failed');}}
async function reissue(deviceKey,label){
  if(!confirm('Re-issue a fresh access key? The old key stops working; the device picks up the new one on its next connect.'))return;
  const r=await post('/admin/api/devices/approve',{deviceKey,label:label||''});
  if(r.ok){loadDevices();alert('New key staged — the device gets it on its next poll.');}else{alert('Re-issue failed');}}
async function approve(deviceKey){
  const label=prompt('Label for this device (e.g. friend switch):','')||'';
  const r=await post('/admin/api/devices/approve',{deviceKey,label});
  if(r.ok){loadDevices();}else{alert('Approve failed');}}
async function revoke(deviceKey){
  if(!confirm('Revoke this device? It loses access.'))return;
  const r=await post('/admin/api/devices/revoke',{deviceKey});
  if(r.ok){loadDevices();}else{alert('Revoke failed');}}

document.getElementById('clrdeny').addEventListener('click',async()=>{
  if(!confirm('Clear the denial log?'))return;await post('/admin/api/denials/clear');load();});
document.getElementById('logout').addEventListener('click',async()=>{
  await post('/admin/logout');location.reload();});
load();loadDevices();setInterval(()=>{load();loadDevices();},15000);
</script></body></html>`;
}
