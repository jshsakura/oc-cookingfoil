/**
 * The settings tab's automation token panel: make a token for a script or an AI
 * assistant (shown once), see when each was last used, and revoke it; turn the MCP
 * endpoint on or off and show how Claude Code and Codex connect to it.
 * Talks to /admin/api/tokens (api-tokens-api.js) and /admin/api/server-settings (mcpEnabled).
 */

export const TOKENS_HTML = `<div class="hd"><h2>자동화 토큰</h2></div>
<p class="muted">스크립트나 AI 도우미가 관리 페이지와 같은 일을 하게 할 때 씁니다. 토큰은 만든 관리자 계정으로 동작하고, 계정과 로그인 방식은 바꿀 수 없습니다. 도우미에게는 서버 주소, 토큰, 운영 안내를 함께 건넵니다. 다 쓰면 삭제합니다.</p>
<form class="add" id="tok-form" autocomplete="off">
  <input id="tok-label" placeholder="어디에 쓸지 (예: Claude)" aria-label="토큰 이름" maxlength="64">
  <button class="primary" type="submit">토큰 만들기</button>
</form>
<div class="copy-row" id="tok-new" hidden><code id="tok-value"></code><button type="button" id="tok-copy">복사</button></div>
<p class="muted" id="tok-note" hidden>이 토큰은 지금 한 번만 보입니다. 복사해 두고 화면을 떠나면 다시 볼 수 없습니다.</p>
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
    table('tok-list',['이름','만든 계정','만든 때','마지막 사용',''],d.tokens.map((t)=>{const tr=el('tr');
      const b=btn('삭제',async()=>{if(!await ask('이 토큰을 삭제할까요? 이 토큰을 쓰던 곳은 바로 막힙니다.'))return;
        try{await api('/admin/api/tokens/'+t.id+'/revoke',{method:'POST',body:{}});toast('삭제했습니다.');loadTokens();}catch(err){toast(err.message);}},'danger');
      const c=el('td');c.append(b);
      tr.append(td(t.label||'—'),td(String(t.owner).replace(/^google:.*/,'구글 계정')),td(fmt(t.createdAt)),td(fmt(t.lastUsedAt)),c);return tr;}),'아직 토큰이 없습니다.');
  }catch(err){toast(err.message);}
}
$('tok-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{const d=await api('/admin/api/tokens',{method:'POST',body:{label:$('tok-label').value}});
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
$('tok-copy').addEventListener('click',()=>{navigator.clipboard?.writeText($('tok-value').textContent).then(()=>toast('복사했습니다.'),()=>toast('복사하지 못했습니다. 직접 골라 복사합니다.'));});
`;
