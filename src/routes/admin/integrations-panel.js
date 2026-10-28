/**
 * The settings tab's "outside services" panel: one card per service with what
 * it is for, where to get its key, and the form to save and test it.
 * Talks to /admin/api/integrations (integrations-api.js).
 */

import { box } from "./boxes.js";
import { top, topHtml, topPh, topLabel } from "./top-i18n.js";

const SERVICES = [
  {
    id: "igdb",
    title: "ig.igdbT",
    use: "ig.igdbU",
    steps: ["ig.igdbS1", "ig.igdbS2", "ig.igdbS3"],
    fields: [["clientId", "ig.clientId"], ["clientSecret", "pp.clientSecret", true]],
  },
  {
    id: "steamgriddb",
    title: "ig.sgdbT",
    use: "ig.sgdbU",
    steps: ["ig.sgdbS1", "ig.sgdbS2"],
    fields: [["apiKey", "ig.apiKey", true]],
  },
  {
    id: "retroAchievements",
    title: "ig.raT",
    use: "ig.raU",
    steps: ["ig.raS1", "ig.raS2"],
    fields: [["apiKey", "ig.webKey", true]],
  },
  {
    id: "dropbox",
    title: "ig.dbT",
    use: "ig.dbU",
    steps: ["ig.dbS1", "ig.dbS2", "ig.dbS3", "ig.dbS4"],
    fields: [["appKey", "ig.appKey"], ["redirectBase", "ig.publicBase"]],
    redirect: true,
  },
  {
    id: "github",
    title: "ig.ghT",
    use: "ig.ghU",
    steps: ["ig.ghS1", "ig.ghS2"],
    fields: [["token", "ig.token", true]],
  },
];

// Services the server uses without a key, so the admin sees everything it talks to.
const KEYLESS = [
  ["titledb", "ig.k.titledbT", "ig.k.titledbU", "github.com/blawar/titledb", "https://github.com/blawar/titledb"],
  ["steam", "ig.k.steamT", "ig.k.steamU", "store.steampowered.com", null],
  ["libretro", "ig.k.libretroT", "ig.k.libretroU", "github.com/libretro-thumbnails", "https://github.com/libretro-thumbnails"],
  ["bezel", "ig.k.bezelT", "ig.k.bezelU", "github.com/thebezelproject", "https://github.com/thebezelproject"],
  ["launchbox", "ig.k.launchboxT", "ig.k.launchboxU", "gamesdb.launchbox-app.com", "https://gamesdb.launchbox-app.com"],
  ["releases", "ig.k.releasesT", "ig.k.releasesU", "api.github.com", null],
  ["google", "ig.k.googleT", "ig.k.googleU", "accounts.google.com", null],
];

const card = (s) => `<div class="intg" data-svc="${s.id}">
  <div class="intg-hd"><h3>${top(s.title)}</h3><span class="intg-state" data-state></span></div>
  <p class="muted">${top(s.use)}</p>
  <ol class="intg-steps">${s.steps.map((x) => `<li>${topHtml(x)}</li>`).join("")}</ol>
  ${s.redirect ? '<div class="copy-row"><code data-redirect>'+top('loading')+'</code></div>' : ""}
  <form class="add" autocomplete="off">
    ${s.fields.map(([k, fk, secret]) => `<input name="${k}" ${secret ? 'type="password" autocomplete="new-password"' : 'spellcheck="false"'} ${topPh(fk)} ${topLabel(fk)} maxlength="300">`).join("")}
    <button class="primary" type="submit" data-top="fp.save">${top("fp.save")}</button>
    <button type="button" data-test>${top("ig.test")}</button>
    <button type="button" class="danger" data-clear data-top="pp.delete">${top("pp.delete")}</button>
  </form>
  <p class="muted" data-msg></p>
</div>`;

const keyless = ([id, title, use, host, href]) => `<div class="intg-free" data-free="${id}">
  <div class="intg-hd"><h3>${top(title)}</h3><span class="intg-state on" data-free-state>${top("ig.noKey")}</span></div>
  <p class="muted">${top(use)} <span class="intg-host">${href ? `<a href="${href}" target="_blank" rel="noopener">${host}</a>` : host}</span></p>
</div>`;

export const INTEGRATIONS_HTML = `<h2 id="intg-h">${top("m.setIntegrations")}</h2>
<p class="muted">${top("ig.lede")}</p>
${SERVICES.map(card).join("\n")}
${box("keyless", top("ig.keylessTitle"), `<p class="muted">${top("ig.keylessLede")}</p>
<div class="intg-frees">${KEYLESS.map(keyless).join("\n")}</div>`, { meta: top("ig.keylessMeta") })}`;

export const INTEGRATIONS_CSS = `
.intg{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:16px 18px;margin-bottom:12px}
.intg-hd{display:flex;align-items:center;gap:10px;justify-content:space-between}.intg h3{margin:0;font-size:var(--fs-md)}
.intg-state{font-size:var(--fs-xs);font-weight:700;padding:3px 10px;border-radius:var(--r-pill);background:var(--sunk);color:var(--muted)}
.intg-state.on{color:var(--good)}
.intg-steps{margin:6px 0 12px;padding-left:20px;color:var(--muted);font-size:var(--fs-sm)}.intg-steps li{margin-bottom:4px}
.intg-steps code{font-size:var(--fs-xs)}
.intg-frees{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.intg-free{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-xl);padding:12px 16px}.intg-free h3{margin:0;font-size:var(--fs-md)}
.intg-free p{margin:6px 0 0;font-size:var(--fs-sm)}.intg-host{display:block;margin-top:4px;font-size:var(--fs-xs);word-break:break-all}
.intg-state.off{color:var(--muted)}
`;

export const INTEGRATIONS_SCRIPT = /* js */ `
const INTG_SOURCE={admin:'ig.src.admin',env:'ig.src.env',none:'ig.src.none'};
async function loadIntegrations(){
  try{const d=await api('/admin/api/integrations');
    document.querySelectorAll('.intg').forEach((c)=>{const s=d[c.dataset.svc];if(!s)return;
      const st=c.querySelector('[data-state]');st.textContent=s.configured?topFill('ig.on',{src:topText(INTG_SOURCE[s.source])}):topText(INTG_SOURCE.none);st.classList.toggle('on',s.configured);
      for(const [k,f] of Object.entries(s.fields)){const i=c.querySelector('input[name="'+k+'"]');if(!i)continue;
        if('value' in f)i.value=f.value||'';else{i.value='';if(f.set)i.dataset.topPhTail='ig.storedSet';else delete i.dataset.topPhTail;i.placeholder=i.getAttribute('aria-label')+(f.set?topText('ig.storedSet'):'');}}
      const r=c.querySelector('[data-redirect]');if(r)r.textContent=d.dropboxRedirectUri||'';});
  }catch(err){toast(err.message);}
}
document.querySelectorAll('.intg').forEach((c)=>{const svc=c.dataset.svc;const msg=c.querySelector('[data-msg]');
  c.querySelector('form').addEventListener('submit',async(e)=>{e.preventDefault();
    const body=Object.fromEntries([...c.querySelectorAll('input[name]')].map((i)=>[i.name,i.value]));
    try{await api('/admin/api/integrations/'+svc,{method:'POST',body});msg.textContent='';toast(topText('pp.saved'));loadIntegrations();}catch(err){msg.textContent=err.message;}});
  c.querySelector('[data-test]').addEventListener('click',async()=>{msg.textContent=topText('ig.testing');
    try{const r=await api('/admin/api/integrations/'+svc+'/test',{method:'POST',body:{}});msg.textContent=r.message;}catch(err){msg.textContent=err.message;}});
  c.querySelector('[data-clear]').addEventListener('click',async()=>{if(!await ask(topText('ig.askClear'),{danger:true}))return;
    try{await api('/admin/api/integrations/'+svc+'/clear',{method:'POST',body:{}});toast(topText('pp.deleted'));loadIntegrations();}catch(err){msg.textContent=err.message;}});
});
`;
