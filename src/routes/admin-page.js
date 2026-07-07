/**
 * /admin — 2FA-gated operator dashboard.
 *
 * Mounted INSIDE the basic-auth perimeter (admin authenticates with shop
 * credentials like everyone), then a TOTP second factor unlocks the page:
 *
 *   GET  /admin            → TOTP prompt, or the dashboard once a session exists
 *   POST /admin/verify     → { code } → mint session cookie
 *   POST /admin/logout     → drop the session
 *   GET  /admin/api/stats  → per-user access stats (session required)
 *
 * Disabled (404) unless COOK_ADMIN_TOTP_SECRET is set.
 */
import express from "express";

import * as store from "../security/store.js";
import {
  adminTotpEnabled,
  verifyTotp,
  issueSession,
  clearSession,
  hasValidSession,
} from "../security/admin-session.js";
import { getUsersFromEnv } from "../authUsersParser.js";
import {
  normalizeDeviceKey,
  generateAccessKey,
  hashAccessKey,
  stageAccessKeyDelivery,
} from "../security/pairing.js";
import { devicePairing } from "../helpers/envs.js";
import debug from "../debug.js";

function gatePage() {
  return /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil · Admin</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
font:14px/1.5 system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4}
.box{background:#181825;border:1px solid #313244;border-radius:18px;padding:32px;width:320px;text-align:center;
box-shadow:0 30px 60px rgba(0,0,0,.4)}.logo{font-size:40px;margin-bottom:8px}
h1{font-size:18px;margin:0 0 4px}p{color:#a6adc8;font-size:13px;margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:12px;font-size:22px;letter-spacing:8px;text-align:center;
border-radius:10px;border:1px solid #45475a;background:#11111b;color:#cdd6f4;font-family:inherit}
button{margin-top:14px;width:100%;padding:11px;border:none;border-radius:10px;cursor:pointer;
background:linear-gradient(135deg,#fab387,#b4befe);color:#11111b;font-weight:700;font-size:14px}
.err{color:#f38ba8;font-size:13px;min-height:18px;margin-top:10px}</style></head><body>
<div class="box"><div class="logo">🔐</div><h1>Admin access</h1>
<p>Enter the 6-digit code from your authenticator app.</p>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus>
<button id="go" type="button">Unlock</button><div class="err" id="err"></div></div>
<script>
const code=document.getElementById('code'),go=document.getElementById('go'),err=document.getElementById('err');
async function submit(){err.textContent='';const v=code.value.trim();
if(!/^\\d{6}$/.test(v)){err.textContent='Enter 6 digits';return;}
go.disabled=true;try{const r=await fetch('/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:v})});
if(r.ok){location.reload();}else{err.textContent='Invalid code';code.value='';code.focus();}}
catch{err.textContent='Network error';}finally{go.disabled=false;}}
go.addEventListener('click',submit);
code.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
</script></body></html>`;
}

function dashboardPage() {
  return /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CookingFoil · Admin</title><style>
:root{color-scheme:dark}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;padding:28px}
.wrap{max-width:920px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
h1{font-size:20px;margin:0}.muted{color:#a6adc8;font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.card{background:#181825;border:1px solid #313244;border-radius:14px;padding:16px}
.card .v{font-size:24px;font-weight:700}.card .l{color:#a6adc8;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#a6adc8;margin:22px 0 10px}
table{width:100%;border-collapse:collapse;background:#181825;border:1px solid #313244;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;font-size:13px;border-bottom:1px solid #262637}
th{color:#a6adc8;font-weight:600;background:#11111b}tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:2px 8px;border-radius:100px;font-size:11px;background:#313244;color:#cdd6f4}
.pill.on{background:rgba(166,227,161,.18);color:#a6e3a1}.pill.off{background:rgba(243,139,168,.16);color:#f38ba8}
.ip{color:#a6adc8;font-size:12px;font-family:ui-monospace,monospace}
button{padding:8px 14px;border:1px solid #45475a;border-radius:9px;cursor:pointer;background:transparent;color:#cdd6f4;font:inherit;font-size:13px}
.empty{color:#6c7086;padding:14px;text-align:center}</style></head><body>
<div class="wrap"><header><div><h1>🧈 CookingFoil Admin</h1><div class="muted" id="ts">loading…</div></div>
<button id="logout" type="button">Log out</button></header>
<div class="cards" id="cards"></div>
<h2>Users</h2><div id="users"></div>
<h2>Lockouts</h2><div id="lockouts"></div>
<h2>Devices <span class="muted" id="devhint"></span></h2>
<div id="pending"></div><div id="devices"></div></div>
<script>
const fmt=t=>t?new Date(t).toLocaleString():'—';
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
async function load(){
  const r=await fetch('/admin/api/stats',{headers:{Accept:'application/json'}});
  if(r.status===401){location.reload();return;}
  const d=await r.json();
  document.getElementById('ts').textContent='Updated '+fmt(d.generatedAt);
  const cards=document.getElementById('cards');cards.innerHTML='';
  const stat=(l,v)=>{const c=el('div',null,'card');c.appendChild(el('div',v,'v'));c.appendChild(el('div',l,'l'));return c;};
  cards.appendChild(stat('Users',d.totals.configuredUsers));
  cards.appendChild(stat('Active',d.totals.activeUsers));
  cards.appendChild(stat('Requests',d.totals.totalRequests));
  cards.appendChild(stat('Lockouts',d.totals.lockouts));
  const ub=document.getElementById('users');ub.innerHTML='';
  if(!d.users.length){ub.appendChild(el('div','No configured users','empty'));}
  else{const t=el('table');t.innerHTML='<tr><th>User</th><th>Status</th><th>Last seen</th><th>Requests</th><th>Last IP</th></tr>';
    for(const u of d.users){const tr=document.createElement('tr');
      tr.appendChild(el('td',u.user));
      const st=el('td');const p=el('span',u.lastAt?'active':'never',u.lastAt?'pill on':'pill off');st.appendChild(p);tr.appendChild(st);
      tr.appendChild(el('td',fmt(u.lastAt)));
      tr.appendChild(el('td',String(u.count||0)));
      const ip=el('td',u.lastIp||'—');ip.className='ip';tr.appendChild(ip);
      t.appendChild(tr);} ub.appendChild(t);}
  const lb=document.getElementById('lockouts');lb.innerHTML='';
  if(!d.lockouts.length){lb.appendChild(el('div','No active lockouts','empty'));}
  else{const t=el('table');t.innerHTML='<tr><th>IP</th><th>Reason</th><th>Since</th><th>Until</th></tr>';
    for(const l of d.lockouts){const tr=document.createElement('tr');
      const ip=el('td',l.ip);ip.className='ip';tr.appendChild(ip);
      tr.appendChild(el('td',l.reason||'—'));
      tr.appendChild(el('td',fmt(l.lockedAt)));
      tr.appendChild(el('td',l.until?fmt(l.until):'forever'));
      t.appendChild(tr);} lb.appendChild(t);}
}
async function loadDevices(){
  const r=await fetch('/admin/api/devices',{headers:{Accept:'application/json'}});
  if(r.status===401){location.reload();return;}
  const d=await r.json();
  document.getElementById('devhint').textContent=d.pairingEnabled?'':'(off — set COOK_DEVICE_PAIRING=true)';
  const pb=document.getElementById('pending');pb.innerHTML='';
  if(!d.pending.length){pb.appendChild(el('div','No devices awaiting approval','empty'));}
  else{const t=el('table');t.innerHTML='<tr><th>Pending device key</th><th>Seen</th><th>Last IP</th><th></th></tr>';
    for(const p of d.pending){const tr=document.createElement('tr');
      const k=el('td',p.deviceKey.slice(0,16)+'…');k.className='ip';k.title=p.deviceKey;tr.appendChild(k);
      tr.appendChild(el('td',fmt(p.lastSeenAt)));
      const ip=el('td',p.lastIp||'—');ip.className='ip';tr.appendChild(ip);
      const act=el('td');const b=el('button','Approve');b.addEventListener('click',()=>approve(p.deviceKey));act.appendChild(b);tr.appendChild(act);
      t.appendChild(tr);} pb.appendChild(t);}
  const db=document.getElementById('devices');db.innerHTML='';
  if(!d.approved.length){db.appendChild(el('div','No approved devices','empty'));}
  else{const t=el('table');t.innerHTML='<tr><th>Label</th><th>Device key</th><th>Last seen</th><th>Last IP</th><th></th></tr>';
    for(const a of d.approved){const tr=document.createElement('tr');
      tr.appendChild(el('td',a.label||'—'));
      const k=el('td',a.deviceKey.slice(0,16)+'…');k.className='ip';k.title=a.deviceKey;tr.appendChild(k);
      tr.appendChild(el('td',fmt(a.lastSeenAt)));
      const ip=el('td',a.lastIp||'—');ip.className='ip';tr.appendChild(ip);
      const act=el('td');
      const ri=el('button','Re-issue');ri.addEventListener('click',()=>reissue(a.deviceKey,a.label));act.appendChild(ri);
      const b=el('button','Revoke');b.style.marginLeft='6px';b.addEventListener('click',()=>revoke(a.deviceKey));act.appendChild(b);
      tr.appendChild(act);
      t.appendChild(tr);} db.appendChild(t);}
}
async function reissue(deviceKey,label){
  if(!confirm('Re-issue a fresh access key? The old key stops working; the device picks up the new one on its next connect.'))return;
  const r=await fetch('/admin/api/devices/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceKey,label:label||''})});
  if(r.ok){loadDevices();alert('New key staged — the device gets it on its next poll.');}else{alert('Re-issue failed');}
}
async function approve(deviceKey){
  const label=prompt('Label for this device (e.g. friend switch):','')||'';
  const r=await fetch('/admin/api/devices/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceKey,label})});
  if(r.ok){loadDevices();}else{alert('Approve failed');}
}
async function revoke(deviceKey){
  if(!confirm('Revoke this device? It loses access.'))return;
  const r=await fetch('/admin/api/devices/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceKey})});
  if(r.ok){loadDevices();}else{alert('Revoke failed');}
}
document.getElementById('logout').addEventListener('click',async()=>{
  await fetch('/admin/logout',{method:'POST'});location.reload();});
load();loadDevices();setInterval(()=>{load();loadDevices();},15000);
</script></body></html>`;
}

export default function adminPageRouter() {
  const router = express.Router();
  router.use(express.json());

  // Hard 404 when 2FA isn't configured — the surface simply doesn't exist.
  router.use((req, res, next) => {
    if (!adminTotpEnabled()) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    next();
  });

  router.get("/", (req, res) => {
    res.type("html").send(hasValidSession(req) ? dashboardPage() : gatePage());
  });

  router.post("/verify", async (req, res) => {
    const ok = await verifyTotp(req.body?.code);
    if (!ok) {
      debug.log("admin 2fa: failed code attempt");
      res.status(401).json({ ok: false });
      return;
    }
    issueSession(res);
    res.json({ ok: true });
  });

  router.post("/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.get("/api/stats", (req, res) => {
    if (!hasValidSession(req)) {
      res.status(401).json({ error: "2fa required" });
      return;
    }
    const access = store.accessSnapshot();
    const byUser = new Map(access.map((a) => [a.user, a]));
    const configured = Object.keys(getUsersFromEnv() ?? {});

    // Configured users first (so never-seen accounts still show), then any
    // historical user no longer in the env list.
    const users = [];
    for (const user of configured) {
      const a = byUser.get(user);
      users.push({
        user,
        configured: true,
        lastAt: a?.lastAt ?? null,
        firstAt: a?.firstAt ?? null,
        count: a?.count ?? 0,
        lastIp: a?.lastIp ?? null,
        ips: a?.ips ?? [],
      });
      byUser.delete(user);
    }
    for (const a of byUser.values()) {
      users.push({ ...a, configured: false });
    }

    const lockouts = store.snapshot().lockouts;
    res.set("Cache-Control", "no-store");
    res.json({
      generatedAt: Date.now(),
      users,
      lockouts,
      totals: {
        configuredUsers: configured.length,
        activeUsers: access.length,
        totalRequests: access.reduce((s, a) => s + (a.count || 0), 0),
        lockouts: lockouts.length,
      },
    });
  });

  // ── Device pairing (CyberFoil) ──────────────────────────────────────────
  // Approved + pending devices, plus approve/revoke. Session-gated like stats;
  // the cf_admin cookie (Path=/admin) rides along automatically from the page.
  router.get("/api/devices", (req, res) => {
    if (!hasValidSession(req)) {
      res.status(401).json({ error: "2fa required" });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json({ pairingEnabled: devicePairing, ...store.devicesSnapshot() });
  });

  router.post("/api/devices/approve", (req, res) => {
    if (!hasValidSession(req)) {
      res.status(401).json({ error: "2fa required" });
      return;
    }
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const label = String(req.body?.label ?? "").slice(0, 64).trim();

    // Mint a fresh accessKey, persist only its hash, stage the plaintext for the
    // device's next status poll (one-time, in-memory). Re-approving rotates it.
    const accessKey = generateAccessKey();
    store.approveDevice(deviceKey, {
      label,
      addedBy: "admin",
      accessKeyHash: hashAccessKey(accessKey),
    });
    stageAccessKeyDelivery(deviceKey, accessKey);
    debug.log("admin: approved device %s… (%s)", deviceKey.slice(0, 12), label || "no label");
    res.json({ ok: true, deviceKey });
  });

  router.post("/api/devices/revoke", (req, res) => {
    if (!hasValidSession(req)) {
      res.status(401).json({ error: "2fa required" });
      return;
    }
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const removed = store.revokeDevice(deviceKey);
    debug.log("admin: revoke device %s… → %s", deviceKey.slice(0, 12), removed);
    res.json({ ok: true, revoked: removed ? 1 : 0 });
  });

  return router;
}
