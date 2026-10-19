/**
 * The admin page's alerts tab: which Telegram bot and chat, which events, a
 * test message and what was told lately. Talks to /admin/api/alerts.
 */

export const ALERTS_HTML = `<section id="tab-alerts" hidden>
  <h2 class="first">텔레그램 알림</h2>
  <p class="muted">처리할 일이나 위험한 접근이 생기면 텔레그램으로 알립니다. 같은 일은 30분에 한 번만, 위험한 접근은 10분씩 모아 보냅니다. 비밀번호, 주소, 이메일은 담지 않습니다.</p>
  <div class="al-status" id="al-status"><span class="al-dot"></span><div><strong>불러오고 있습니다</strong><span></span></div></div>
  <div class="subtabs" id="alerts-subtabs" role="tablist" aria-label="알림 구역">
    <button type="button" role="tab" data-sub="setup" aria-selected="true">설정</button>
    <button type="button" role="tab" data-sub="history" aria-selected="false">최근 알림</button>
  </div>
  <div data-sub-panel="setup">
  <form id="al-form" autocomplete="off">
    <h3>연결</h3>
    <ol class="intg-steps">
      <li>텔레그램에서 <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> 에게 /newbot 을 보내 봇을 만들고, 받은 토큰을 넣습니다.</li>
      <li>알림을 받을 대화(봇과의 1:1 대화나 봇을 넣은 그룹)에서 봇에게 아무 말이나 보냅니다.</li>
      <li>대화 찾기를 누르면 채팅 ID 를 채웁니다. 저장한 뒤 시험 메시지로 확인합니다.</li>
    </ol>
    <div class="add">
      <input name="botToken" type="password" autocomplete="new-password" placeholder="봇 토큰" aria-label="봇 토큰" maxlength="120">
      <input name="chatId" spellcheck="false" placeholder="채팅 ID" aria-label="채팅 ID" maxlength="70">
      <button type="button" id="al-chats">대화 찾기</button>
    </div>
    <h3>받을 알림</h3>
    <div class="al-events" id="al-events"></div>
    <h3>텔레그램에서 승인</h3>
    <label class="al-event"><input type="checkbox" name="buttons"><b>버튼으로 승인합니다</b><small>텔레그램 대화방에서 버튼으로 기기와 계정을 승인합니다. 대화방을 가진 사람이 승인할 수 있게 됩니다. 버튼은 한 번만 쓸 수 있고 24시간 뒤에 만료됩니다.</small></label>
    <p class="muted">그룹으로 알림을 받는다면 버튼을 누를 수 있는 사람의 텔레그램 사용자 ID 를 넣습니다. 쉼표로 여럿 넣을 수 있고, 그룹 관리자라도 여기 없으면 누를 수 없습니다. 봇과의 1:1 대화라면 비워 둡니다.</p>
    <div class="add"><input name="approvers" spellcheck="false" placeholder="승인할 사용자 ID" aria-label="승인할 사용자 ID" maxlength="300"></div>
    <div class="row" id="al-users"></div>
    <div class="row">
      <button class="primary" type="submit">저장</button>
      <button type="button" id="al-test">시험 메시지 보내기</button>
      <button type="button" class="danger" id="al-clear">삭제</button>
    </div>
    <p class="muted" id="al-msg"></p>
  </form>
  </div>
  <div data-sub-panel="history" hidden>
  <p class="muted">보낸 것과 보내지 않은 것을 함께 남깁니다. 최근 50건입니다.</p>
  <div class="scroll" id="al-history"></div>
  </div>
</section>`;

export const ALERTS_CSS = `
.al-status{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:12px 0 18px}
.al-status strong{display:block;font-size:15px}.al-status span:not(.al-dot){font-size:13px;color:var(--muted)}
.al-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}.al-status.on .al-dot{background:var(--good)}.al-status.bad .al-dot{background:var(--bad,#d33)}
#al-form h3{margin:18px 0 8px;font-size:15px}
#al-form .add{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin-bottom:6px}
#al-form .add input{flex:1 1 220px;min-width:0}
#al-form .add button{flex:none;white-space:nowrap}
#al-form .row{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin-top:14px}
#al-form .row:empty{display:none}
#al-form .row button{white-space:nowrap}
#al-msg:empty{display:none}#al-msg{margin-top:10px}
@media(max-width:640px){#al-form .add button,#al-form .row button{flex:1 1 auto}}
.al-events{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:14px}
.al-event{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;cursor:pointer}
.al-event input{margin-top:3px;width:18px;height:18px}.al-event b{font-size:14px}.al-event small{grid-column:2;color:var(--muted);font-size:12.5px;line-height:1.5}
.al-st{font-size:12px;font-weight:700;padding:2px 9px;border-radius:100px;background:var(--sunk);color:var(--muted);white-space:nowrap}
.al-st.sent{color:var(--good)}.al-st.failed{color:var(--bad,#d33)}
`;

export const ALERTS_SCRIPT = /* js */ `
const AL_STATUS={sent:'보냄',failed:'실패',held:'반복이라 쉼',off:'꺼 둔 알림'};
let alData=null;
async function loadAlerts(){
  try{alData=await api('/admin/api/alerts');}catch(err){toast(err.message);return;}
  const d=alData,st=$('al-status');
  st.classList.toggle('on',d.configured&&d.bot!==null);st.classList.toggle('bad',d.bot===null);
  const [title,sub]=!d.tokenSet?['꺼져 있습니다','봇 토큰과 채팅 ID 를 넣으면 켜집니다.']
    :d.bot===null?['봇 토큰이 맞지 않습니다','텔레그램이 이 토큰을 받아들이지 않습니다. BotFather 에서 토큰을 다시 확인합니다.']
    :!d.chatId?['채팅 ID 가 없습니다','봇에게 말을 건 뒤 대화 찾기를 누릅니다.']
    :['켜져 있습니다',(d.bot?'@'+d.bot+' 가 ':'')+'채팅 '+d.chatId+' 로 보냅니다'+(d.source==='env'?' (환경변수)':'')+'.'];
  st.querySelector('strong').textContent=title;st.querySelector('span:not(.al-dot)').textContent=sub;
  const f=$('al-form');f.botToken.value='';f.botToken.placeholder='봇 토큰'+(d.tokenSet?' (저장돼 있습니다. 바꿀 때만 넣습니다)':'');f.chatId.value=d.chatId||'';f.buttons.checked=d.buttons===true;f.approvers.value=(d.approvers||[]).join(',');
  // People the bot heard from lately; a click adds one to the list.
  $('al-users').replaceChildren(...(d.users||[]).length?[el('span','최근 봇에게 말을 건 사람:','muted'),...d.users.map((u)=>btn((u.name||'이름 없음')+' ('+u.id+')',()=>{
    const ids=f.approvers.value.split(',').map((x)=>x.trim()).filter(Boolean);if(!ids.includes(u.id))f.approvers.value=[...ids,u.id].join(',');}))]:[]);
  $('al-events').replaceChildren(...d.events.map((e)=>{const l=el('label',null,'al-event');const b=document.createElement('input');b.type='checkbox';b.value=e.id;b.checked=e.on;
    l.append(b,el('b',e.label),el('small',e.desc));return l;}));
  const label=(id)=>(d.events.find((e)=>e.id===id)||{}).label||(id==='test'?'알림 시험':id);
  pagedTable('al-history',['시각','알림','내용','결과'],d.history,(h)=>{const tr=el('tr');const w=td(ago(h.at));w.title=fmt(h.at);
    const r=td();r.append(el('span',AL_STATUS[h.status]||h.status,'al-st '+h.status));if(h.detail)r.append(el('div',h.detail,'muted'));
    tr.append(w,td(label(h.event)),td(h.text),r);return tr;},'아직 알림이 없습니다.',{label:'최근 알림',placeholder:'알림 내용으로 찾기',def:10});
}
$('al-form').addEventListener('submit',async(e)=>{e.preventDefault();const f=e.target;
  const events=[...$('al-events').querySelectorAll('input:checked')].map((b)=>b.value);
  try{await api('/admin/api/alerts',{method:'POST',body:{botToken:f.botToken.value.trim(),chatId:f.chatId.value.trim(),events,buttons:f.buttons.checked,approvers:f.approvers.value.split(',').map((x)=>x.trim()).filter(Boolean)}});$('al-msg').textContent='';toast('저장했습니다.');loadAlerts();}
  catch(err){$('al-msg').textContent=err.message;}});
$('al-test').addEventListener('click',async()=>{$('al-msg').textContent='보내고 있습니다';
  try{const r=await api('/admin/api/alerts/test',{method:'POST',body:{}});$('al-msg').textContent=r.message;loadAlerts();}catch(err){$('al-msg').textContent=err.message;}});
$('al-chats').addEventListener('click',async()=>{$('al-msg').textContent='찾고 있습니다';const f=$('al-form');
  try{const r=await api('/admin/api/alerts/chats',{method:'POST',body:{botToken:f.botToken.value.trim()}});
    if(r.ok&&r.chats.length){f.chatId.value=r.chats[0].id;const list=r.chats.map((x)=>x.title?x.title+' ('+x.id+')':x.id).join(', ');
      $('al-msg').textContent=r.chats.length>1?'대화가 여럿이라 첫 번째를 넣었습니다: '+list+'. 다른 대화라면 고쳐 넣습니다.':'채팅 ID 를 넣었습니다: '+list+'. 저장합니다.';}
    else $('al-msg').textContent=r.message;}catch(err){$('al-msg').textContent=err.message;}});
$('al-clear').addEventListener('click',async()=>{if(!await ask('저장한 알림 설정을 삭제할까요? 환경변수에 넣은 값이 있으면 그 값으로 돌아갑니다.'))return;
  try{await api('/admin/api/alerts/clear',{method:'POST',body:{}});toast('삭제했습니다.');loadAlerts();}catch(err){$('al-msg').textContent=err.message;}});
`;
