/**
 * The admin page chrome every page shares: the account circle and its menu,
 * the theme switch, the sign-out chain, and the sidebar's count badges.
 *
 * The whole-page dashboard used to wire these inside its own script; the split
 * pages of the redesign need the very same wiring, so it lives here and both
 * inline it. The identity and the badges come from one small counts answer
 * the shell asks for on load.
 */
export const CHROME_SCRIPT = /* js */ `
// ── the account circle and its menu ────────────────────────────────────
function setAcct(open){$('acct-list').hidden=!open;$('acct-btn').setAttribute('aria-expanded',String(open));
  if(typeof actSetOpenState==='function')actSetOpenState(open);}
if($('acct-btn'))$('acct-btn').addEventListener('click',(e)=>{e.stopPropagation();setAcct($('acct-list').hidden);});
document.addEventListener('click',(e)=>{const l=$('acct-list');
  if(l&&!l.hidden&&!e.target.closest('.acct-menu'))setAcct(false);});
document.addEventListener('keydown',(e)=>{const l=$('acct-list');
  if(e.key==='Escape'&&l&&!l.hidden){setAcct(false);$('acct-btn').focus();}});

// Signs out of the admin page and of the web session together.
if($('logout'))$('logout').addEventListener('click',async()=>{try{await fetch('/admin/logout',{method:'POST'});
  const me=await fetch('/auth/me').then((r)=>r.ok?r.json():null);if(me)await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':me.csrf}});}
  finally{location.href='/login?next=%2Fadmin';}});

// ── theme: the system setting until the switch is used here or on the web ──
const THEME_KEY='cookingfoil:theme';
const systemLight=matchMedia('(prefers-color-scheme: light)');
const currentTheme=()=>document.documentElement.dataset.theme||(systemLight.matches?'light':'dark');
function syncThemeMenu(){const t=$('theme-toggle');if(t)t.setAttribute('aria-checked',String(currentTheme()==='dark'));}
if($('theme-toggle'))$('theme-toggle').addEventListener('click',()=>{const v=currentTheme()==='dark'?'light':'dark';
  document.documentElement.dataset.theme=v;
  try{localStorage.setItem(THEME_KEY,v);}catch{/* storage blocked: this visit only */}
  syncThemeMenu();});
systemLight.addEventListener('change',syncThemeMenu);
syncThemeMenu();

// ── who is in, and the sidebar's four numbers ─────────────────────────
// One small answer for the identity and the counts, refreshed on the same
// visibility-aware timer the page data uses. The timer's first tick calls
// fn immediately, so there is exactly one initial request.
async function chromeCounts(){
  try{const r=await fetch('/admin/api/counts',{headers:{Accept:'application/json'}});
    if(!r.ok)return;const d=await r.json();
    if(typeof acctAvatar==='function')acctAvatar(d.me?.avatar||null);
    const set=(id,n)=>{const el=$(id);if(el){el.textContent=n;el.hidden=!n;}};
    set('inbox-count',d.inbox??0);set('account-count',d.pendingAccounts??0);
    set('pending-count',d.pendingDevices??0);set('lock-count',d.lockouts??0);
    if(typeof __admSums==='function')__admSums();}
  catch{/* the badges keep their last values */}}
if(typeof admInterval==='function')admInterval(chromeCounts,30000);
`;
