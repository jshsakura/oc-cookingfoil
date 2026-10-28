import { top, topPh, topLabel } from "./top-i18n.js";
/**
 * The settings tab's automation token panel: make a token for a script or an AI
 * assistant (shown once), see when each was last used, and revoke it; turn the MCP
 * endpoint on or off and show how Claude Code and Codex connect to it.
 * Talks to /admin/api/tokens (api-tokens-api.js) and /admin/api/server-settings (mcpEnabled).
 */

export const TOKENS_HTML = `<div class="hd"><h2>${top("tok.h2")}</h2></div>
<p class="muted">${top("tok.lede")}</p>
<form class="add" id="tok-form" autocomplete="off">
  <input id="tok-label" ${topPh("tok.labelPh")} ${topLabel("tok.labelAria")} maxlength="64">
  <select id="tok-scope" ${topLabel("tok.scope")}><option value="admin">${top("tok.scopeAdmin")}</option><option value="catalog">${top("tok.scopeCatalog")}</option></select>
  <button class="primary" type="submit">${top("tok.makeBtn")}</button>
</form>
<div class="copy-row" id="tok-new" hidden><code id="tok-value"></code><button type="button" id="tok-copy" data-top="ov.copy">${top("ov.copy")}</button></div>
<p class="muted" id="tok-note" hidden>${top("tok.onceNote")}</p>
<div class="scroll" id="tok-list" data-skel></div>
<div class="hd"><h2 data-top="mcp.title"></h2></div>
<div class="ss-row"><div><b data-top="mcp.switch"></b><p data-top="mcp.lead"></p></div>
  <div class="ss-ctl"><label class="ss-switch"><input type="checkbox" id="mcp-on" data-top-label="mcp.switch"><span></span></label></div></div>
<div id="mcp-howto" hidden>
  <p class="muted" data-top="mcp.token"></p>
  <p data-top="mcp.claude"></p>
  <div class="copy-row"><code id="mcp-claude"></code><button type="button" data-copy="mcp-claude" data-top="mcp.copy"></button></div>
  <p data-top="mcp.project"></p>
  <div class="copy-row"><code id="mcp-project" style="white-space:pre"></code><button type="button" data-copy="mcp-project" data-top="mcp.copy"></button></div>
  <p data-top="mcp.codex"></p>
  <div class="copy-row"><code id="mcp-codex" style="white-space:pre"></code><button type="button" data-copy="mcp-codex" data-top="mcp.copy"></button></div>
</div>`;

export const TOKENS_SCRIPT = /* js */ `
async function loadTokens(){
  try{const d=await api('/admin/api/tokens');
    table('tok-list',[topText('tok.name'),topText('tok.scope'),topText('tok.owner'),topText('tok.created'),topText('tok.lastUsed'),''],d.tokens.map((t)=>{const tr=el('tr');
      const b=btn(topText('tok.delete'),async()=>{if(!await ask(topText('tok.deleteAsk')))return;
        try{await api('/admin/api/tokens/'+t.id+'/revoke',{method:'POST',body:{}});toast(topText('tok.deleted'));loadTokens();}catch(err){toast(err.message);}},'danger');
      const c=el('td');c.append(b);
      tr.append(td(t.label||'—'),td(topText(t.scope==='catalog'?'tok.scopeCatalog':'tok.scopeAdmin')),td(String(t.owner).replace(/^google:.*/,topText('tok.google'))),td(fmt(t.createdAt)),td(fmt(t.lastUsedAt)),c);return tr;}),topText('tok.none'));
  }catch(err){toast(err.message);}
}
$('tok-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{const d=await api('/admin/api/tokens',{method:'POST',body:{label:$('tok-label').value,scope:$('tok-scope').value}});
    $('tok-value').textContent=d.token;$('tok-new').hidden=false;$('tok-note').hidden=false;$('tok-label').value='';loadTokens();}catch(err){toast(err.message);}});
async function loadMcp(){
  try{const d=await api('/admin/api/server-settings');const s=d.settings;
    const base=(s.publicBaseUrl?.value||location.origin).replace(/\\/+$/,'')+'/mcp';
    $('mcp-on').checked=s.mcpEnabled?.value===true;$('mcp-howto').hidden=!$('mcp-on').checked;
    $('mcp-claude').textContent='claude mcp add --transport http cookingfoil '+base+' --header "Authorization: Bearer '+topText('mcp.placeholder')+'"';
    $('mcp-project').textContent=JSON.stringify({mcpServers:{cookingfoil:{type:'http',url:base,headers:{Authorization:'Bearer \${COOKINGFOIL_TOKEN}'}}}},null,2);
    $('mcp-codex').textContent='[mcp_servers.cookingfoil]\\nurl = "'+base+'"\\nbearer_token_env_var = "COOKINGFOIL_TOKEN"';
  }catch(err){toast(err.message);}
}
$('mcp-on').addEventListener('change',async(e)=>{const on=e.target.checked;
  try{await api('/admin/api/server-settings',{method:'POST',body:{mcpEnabled:on}});toast(topText(on?'mcp.opened':'mcp.closed'));$('mcp-howto').hidden=!on;}
  catch(err){e.target.checked=!on;toast(err.message);}});
document.querySelectorAll('[data-copy^="mcp-"]').forEach((b)=>b.addEventListener('click',()=>{navigator.clipboard?.writeText($(b.dataset.copy).textContent).then(()=>toast(topText('mcp.copied')),()=>toast(topText('mcp.copyFailed')));}));
$('tok-copy').addEventListener('click',()=>{navigator.clipboard?.writeText($('tok-value').textContent).then(()=>toast(topText('mcp.copied')),()=>toast(topText('mcp.copyFailed')));});
`;
