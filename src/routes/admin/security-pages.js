/** Independent login and administrator-security panels, shared with the legacy shell. */
import { box } from "./boxes.js";
import { top, topPh, topLabel } from "./top-i18n.js";

export const GOOGLE_SETTINGS_HTML = /* html */ `  ${box("sec-google", top("gs.title"), `
  <p class="muted">${top("gs.lede")}</p>
  <form class="add google-form" id="google-form" autocomplete="off">
    <label class="toggle"><input type="checkbox" id="g-enabled"> ${top("gs.useT")}</label>
    <input id="g-id" ${topPh("gs.idPh")} ${topLabel("ig.clientId")} maxlength="200" spellcheck="false">
    <input id="g-secret" type="password" autocomplete="new-password" ${topPh("pp.clientSecret")} ${topLabel("pp.clientSecret")} maxlength="200">
    <button class="primary" type="submit">${top("fp.save")}</button>
    <button type="button" id="g-clear" class="danger">${top("gs.clearKeys")}</button>
  </form>
  <p class="muted">${top("gs.redirectLede")}</p>
  <div class="copy-row"><code id="g-redirect">${top("loading")}</code><button type="button" id="g-copy">${top("pp.copy")}</button></div>
  <p class="muted" id="g-status"></p>
  `, { meta: top("gs.meta") })}
`;

export const ADMIN_SECURITY_HTML = /* html */ `  ${box("sec-tfa", top("as.tfaTitle"), `
  <div class="tfa" id="tfa">
    <div class="tfa-ok" id="tfa-ok" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg><div><b>${top("as.tfaOkT")}</b><span id="tfa-ok-sub"></span></div></div>
    <p id="tfa-status" class="muted" data-top="loading">${top("loading")}</p>
    <div class="row" id="tfa-actions"></div>
    <div class="tfa-setup" id="tfa-setup" hidden>
      <div class="tfa-qr" id="tfa-qr" role="img" ${topLabel("as.qrAria")}></div>
      <div class="tfa-steps">
        <p class="muted">${top("as.tfaSteps")}</p>
        <div class="tfa-key" id="tfa-key"></div>
        <div class="row" style="margin-top:10px">
          <input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" ${topLabel("as.codeLabel")}>
          <button type="button" class="primary" id="tfa-confirm">${top("as.enrollBtn")}</button>
          <button type="button" id="tfa-cancel" data-top="pp.cancelBtn">${top("pp.cancelBtn")}</button>
        </div>
      </div>
    </div>
  </div>
  `, { open: true, meta: top("as.tfaMeta") })}
  ${box("sec-password", top("as.pwTitle"), `
  <form class="tfa" id="ap-form" autocomplete="off">
    <p id="ap-status" class="muted" data-top="loading">${top("loading")}</p>
    <div class="row">
      <input id="ap-current" type="password" autocomplete="current-password" ${topPh("as.curPh")} ${topLabel("as.curPh")} maxlength="200">
      <input id="ap-new" type="password" autocomplete="new-password" ${topPh("as.newPh")} ${topLabel("as.newLabel")} minlength="12" maxlength="200">
      <input id="ap-new2" type="password" autocomplete="new-password" ${topPh("as.new2Ph")} ${topLabel("as.new2Label")} maxlength="200">
    </div>
    <div class="row"><button class="primary" type="submit">${top("as.setPw")}</button><button type="button" class="danger" id="ap-clear">${top("as.clearPw")}</button></div>
  </form>
  `, { open: true, meta: top("as.pwMeta") })}
`;

export const ADMIN_SECURITY_SCRIPT = /* js */ `
const grouped=(s)=>String(s).replace(/(.{4})/g,'$1 ').trim();
async function loadTfa(){
  let s;try{s=await api('/admin/api/2fa');}catch(e){$('tfa-status').textContent=topFill('as.loadFail',{msg:e.message});return;}
  // Registered: say so plainly, with the shield, instead of offering to register again.
  $('tfa-ok').hidden=!s.authenticator;$('tfa-status').hidden=s.authenticator;
  $('tfa-ok-sub').textContent=s.password?topText('as.okSubPw'):topText('as.okSub');
  $('tfa-status').textContent=s.skipped?topText('as.statusSkipped')
    :s.password?topText('as.statusPw'):topText('as.statusNone');
  $('tfa-status').classList.toggle('tfa-warn',Boolean(s.skipped));
  renderAdminPassword(s);
  const box=$('tfa-actions');box.replaceChildren();
  if(!s.manageable){box.append(el('span',topText('as.fixedSecret'),'muted'));return;}
  box.append(s.authenticator?tbtn('edit','as.switchApp',startTfa):btn(topText('as.enrollApp'),startTfa,'primary'));
  if(s.password&&s.authenticator)box.append(tbtn('disable','as.disableApp',async()=>{
    if(!await ask(topText('as.askDisable'),{danger:true}))return;
    try{await api('/admin/api/2fa/disable',{method:'POST',body:{}});toast(topText('as.disabledToast'));loadTfa();}catch(e){toast(e.message);}}));}
// The admin password set here (stored as a hash); the compose one keeps working beside it.
function renderAdminPassword(s){
  $('ap-status').textContent=s.passwordSaved?topText('as.pwSaved')
    :s.passwordEnv?topText('as.pwEnv'):topText('as.pwNone');
  $('ap-current').hidden=!s.password;$('ap-clear').hidden=!s.passwordSaved;
  // With an authenticator set up, its code stands in for a forgotten password.
  const ph=topText(s.authenticator?'as.curOrCode':'as.curPh');$('ap-current').placeholder=ph;$('ap-current').setAttribute('aria-label',ph);}
$('ap-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const password=$('ap-new').value;if(password!==$('ap-new2').value){toast(topText('as.pwMismatch'));return;}
  try{const s=await api('/admin/api/admin-password',{method:'POST',body:{current:$('ap-current').value,password}});
    for(const id of ['ap-current','ap-new','ap-new2'])$(id).value='';toast(topText('as.pwSet'));renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
$('ap-clear').addEventListener('click',async()=>{if(!await ask(topText('as.askPwClear'),{danger:true}))return;
  try{const s=await api('/admin/api/admin-password/clear',{method:'POST',body:{current:$('ap-current').value}});
    $('ap-current').value='';toast(topText('as.pwCleared'));renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
async function startTfa(){
  try{const d=await api('/admin/api/2fa/start',{method:'POST',body:{}});
    $('tfa-qr').innerHTML=d.qr||'';$('tfa-key').textContent=grouped(d.secret);
    $('tfa-setup').hidden=false;$('tfa-code').value='';$('tfa-code').focus();}catch(e){toast(e.message);}}
async function confirmTfa(){const code=$('tfa-code').value.trim();
  if(!/^\\d{6}$/.test(code)){toast(topText('as.codeDigits'));return;}
  try{await api('/admin/api/2fa/confirm',{method:'POST',body:{code}});
    $('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';
    toast(topText('as.enrolled'));loadTfa();}
  catch(e){toast(e.message==='code does not match'?topText('as.codeWrong'):e.message==='enrollment expired, start again'?topText('as.enrollExpired'):e.message);}}
$('tfa-confirm').addEventListener('click',confirmTfa);
$('tfa-code').addEventListener('keydown',(e)=>{if(e.key==='Enter')confirmTfa();});
$('tfa-cancel').addEventListener('click',()=>{$('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';});

`;
