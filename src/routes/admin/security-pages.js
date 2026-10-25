/** Independent login and administrator-security panels, shared with the legacy shell. */
import { box } from "./boxes.js";

export const GOOGLE_SETTINGS_HTML = /* html */ `  ${box("sec-google", "구글 로그인", `
  <p class="muted">구글 로그인은 덤입니다. 꺼 두면 아이디와 비밀번호로만 로그인하고, 켜면 로그인 화면에 구글 버튼이 붙습니다. 저장하면 바로 적용합니다.</p>
  <form class="add google-form" id="google-form" autocomplete="off">
    <label class="toggle"><input type="checkbox" id="g-enabled"> 구글 로그인(OAuth) 사용</label>
    <input id="g-id" placeholder="클라이언트 ID (….apps.googleusercontent.com)" aria-label="클라이언트 ID" maxlength="200" spellcheck="false">
    <input id="g-secret" type="password" autocomplete="new-password" placeholder="클라이언트 시크릿" aria-label="클라이언트 시크릿" maxlength="200">
    <button class="primary" type="submit">저장</button>
    <button type="button" id="g-clear" class="danger">키 삭제</button>
  </form>
  <p class="muted">구글 클라우드 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 아래 리디렉션 URI를 등록합니다.</p>
  <div class="copy-row"><code id="g-redirect">불러오고 있습니다</code><button type="button" id="g-copy">복사</button></div>
  <p class="muted" id="g-status"></p>
  `, { meta: "로그인 화면의 구글 버튼" })}
`;

export const ADMIN_SECURITY_HTML = /* html */ `  ${box("sec-tfa", "관리 페이지 2단계 인증", `
  <div class="tfa" id="tfa">
    <div class="tfa-ok" id="tfa-ok" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg><div><b>인증 앱이 등록되어 있습니다</b><span id="tfa-ok-sub"></span></div></div>
    <p id="tfa-status" class="muted">불러오고 있습니다</p>
    <div class="row" id="tfa-actions"></div>
    <div class="tfa-setup" id="tfa-setup" hidden>
      <div class="tfa-qr" id="tfa-qr" role="img" aria-label="인증 앱 QR 코드"></div>
      <div class="tfa-steps">
        <p class="muted">인증 앱(Google Authenticator, 1Password 등)으로 QR 을 찍거나 아래 키를 직접 넣습니다. 그다음 앱에 나온 6자리 코드를 입력하면 등록이 끝납니다. 끝내기 전까지는 지금 로그인 방식이 그대로입니다.</p>
        <div class="tfa-key" id="tfa-key"></div>
        <div class="row" style="margin-top:10px">
          <input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="확인 코드">
          <button type="button" class="primary" id="tfa-confirm">등록</button>
          <button type="button" id="tfa-cancel">취소</button>
        </div>
      </div>
    </div>
  </div>
  `, { open: true, meta: "인증 앱 코드" })}
  ${box("sec-password", "관리자 비밀번호", `
  <form class="tfa" id="ap-form" autocomplete="off">
    <p id="ap-status" class="muted">불러오고 있습니다</p>
    <div class="row">
      <input id="ap-current" type="password" autocomplete="current-password" placeholder="지금 비밀번호" aria-label="지금 비밀번호" maxlength="200">
      <input id="ap-new" type="password" autocomplete="new-password" placeholder="새 비밀번호 (12자 이상)" aria-label="새 비밀번호" minlength="12" maxlength="200">
      <input id="ap-new2" type="password" autocomplete="new-password" placeholder="새 비밀번호 한 번 더" aria-label="새 비밀번호 확인" maxlength="200">
    </div>
    <div class="row"><button class="primary" type="submit">비밀번호 정하기</button><button type="button" class="danger" id="ap-clear">여기서 정한 비밀번호 삭제</button></div>
  </form>
  `, { open: true, meta: "관리 페이지에 들어갈 때 넣는 비밀번호" })}
`;

export const ADMIN_SECURITY_SCRIPT = /* js */ `
const grouped=(s)=>String(s).replace(/(.{4})/g,'$1 ').trim();
async function loadTfa(){
  let s;try{s=await api('/admin/api/2fa');}catch(e){$('tfa-status').textContent='불러오지 못했습니다: '+e.message;return;}
  // Registered: say so plainly, with the shield, instead of offering to register again.
  $('tfa-ok').hidden=!s.authenticator;$('tfa-status').hidden=s.authenticator;
  $('tfa-ok-sub').textContent=s.password?'관리 페이지에 들어올 때 앱의 6자리 코드를 묻습니다. 휴대폰이 없을 때는 관리자 비밀번호로도 들어갈 수 있습니다.':'관리 페이지에 들어올 때 앱의 6자리 코드를 묻습니다.';
  $('tfa-status').textContent=s.skipped?'셋업에서 2단계 인증을 건너뛰었습니다. 지금은 관리자 계정 비밀번호만으로 관리 페이지에 들어옵니다. 비밀번호가 새면 누구든 서버를 관리할 수 있으니 인증 앱을 등록합니다.'
    :s.password?'관리자 비밀번호로 들어갑니다. 인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다.':'아직 등록한 인증 앱이 없습니다.';
  $('tfa-status').classList.toggle('tfa-warn',Boolean(s.skipped));
  renderAdminPassword(s);
  const box=$('tfa-actions');box.replaceChildren();
  if(!s.manageable){box.append(el('span','COOK_ADMIN_TOTP_SECRET 으로 고정돼 있어 여기서 바꿀 수 없습니다.','muted'));return;}
  box.append(s.authenticator?btn('다른 앱으로 바꾸기',startTfa):btn('인증 앱 등록',startTfa,'primary'));
  if(s.password&&s.authenticator)box.append(btn('인증 앱 끄기',async()=>{
    if(!await ask('인증 앱을 끄면 관리자 비밀번호로만 들어갑니다. 끌까요?',{danger:true}))return;
    try{await api('/admin/api/2fa/disable',{method:'POST',body:{}});toast('인증 앱을 껐습니다.');loadTfa();}catch(e){toast(e.message);}}));}
// The admin password set here (stored as a hash); the compose one keeps working beside it.
function renderAdminPassword(s){
  $('ap-status').textContent=s.passwordSaved?'여기서 정한 비밀번호가 있습니다. 바꾸려면 지금 비밀번호와 새 비밀번호를 넣습니다.'
    :s.passwordEnv?'compose 의 비밀번호로 들어갑니다. 여기서 비밀번호를 정하면 둘 다 받습니다.'
    :'아직 관리자 비밀번호가 없습니다. 정해 두면 휴대폰이 없을 때도 비밀번호로 들어갑니다.';
  $('ap-current').hidden=!s.password;$('ap-clear').hidden=!s.passwordSaved;}
$('ap-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const password=$('ap-new').value;if(password!==$('ap-new2').value){toast('새 비밀번호 두 칸이 다릅니다.');return;}
  try{const s=await api('/admin/api/admin-password',{method:'POST',body:{current:$('ap-current').value,password}});
    for(const id of ['ap-current','ap-new','ap-new2'])$(id).value='';toast('관리자 비밀번호를 정했습니다.');renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
$('ap-clear').addEventListener('click',async()=>{if(!await ask('여기서 정한 관리자 비밀번호를 삭제합니다.',{danger:true}))return;
  try{const s=await api('/admin/api/admin-password/clear',{method:'POST',body:{current:$('ap-current').value}});
    $('ap-current').value='';toast('비밀번호를 삭제했습니다.');renderAdminPassword(s);loadTfa();}catch(err){toast(err.message);}});
async function startTfa(){
  try{const d=await api('/admin/api/2fa/start',{method:'POST',body:{}});
    $('tfa-qr').innerHTML=d.qr||'';$('tfa-key').textContent=grouped(d.secret);
    $('tfa-setup').hidden=false;$('tfa-code').value='';$('tfa-code').focus();}catch(e){toast(e.message);}}
async function confirmTfa(){const code=$('tfa-code').value.trim();
  if(!/^\\d{6}$/.test(code)){toast('숫자 6자리를 입력합니다.');return;}
  try{await api('/admin/api/2fa/confirm',{method:'POST',body:{code}});
    $('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';
    toast('인증 앱을 등록했습니다. 다음 로그인부터 코드도 묻습니다.');loadTfa();}
  catch(e){toast(e.message==='code does not match'?'코드가 맞지 않습니다. 앱에 나온 최신 코드를 넣습니다.':e.message==='enrollment expired, start again'?'시간이 지났습니다. 다시 등록합니다.':e.message);}}
$('tfa-confirm').addEventListener('click',confirmTfa);
$('tfa-code').addEventListener('keydown',(e)=>{if(e.key==='Enter')confirmTfa();});
$('tfa-cancel').addEventListener('click',()=>{$('tfa-setup').hidden=true;$('tfa-qr').replaceChildren();$('tfa-key').textContent='';});

`;
