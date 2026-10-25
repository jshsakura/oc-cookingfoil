/** Administration overview: status summaries and links to task owners. */
import { box } from "./boxes.js";
import { connectHowto } from "./connect-howto.js";
import { top } from "./top-i18n.js";

export const OVERVIEW_HTML = /* html */ `<section id="tab-overview">
  <h2 class="first">연결</h2>
  <div class="copy-row"><code id="shop-url">—</code><button type="button" id="shop-url-copy">복사</button></div>
  ${box("connect-howto", "기기를 연결하는 방법", `<ul class="howto-list">${connectHowto().map((line) => `<li>${line}</li>`).join("")}</ul>`, { level: "h3", folded: true })}
  <div id="warnings"></div>
  <div class="lanes" id="lanes"></div>
  <div class="lanes" id="health"></div>
  <p class="muted" id="health-hint" hidden></p>
  <div class="cards" id="cards"></div>
  <p><a href="/admin/client">${top("m.client")}</a></p>
  <p class="muted" id="ts"></p>
</section>`;

export const OVERVIEW_SCRIPT = /* js */ `
const WARNINGS={
  'storage-kept':{t:'일부 폴더를 아직 옛 위치에서 읽습니다',d:(w)=>'저장 폴더가 연결됐지만 아래 폴더는 옛 위치에 파일이 남아 있어 그대로 씁니다. 내용을 저장 폴더 안의 같은 이름 폴더로 옮기고 옛 마운트를 빼면 저장 폴더 하나로 정리됩니다. '+(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')},
  'old-incoming':{t:'게임 폴더 안의 옛 incoming 에 파일이 남아 있습니다',d:(w)=>'새 incoming 에 같은 이름이 있거나 다른 디스크라 옮기지 못했습니다. 직접 옮기기 전에는 목록에도 정리에도 들어가지 않습니다. '+(w.paths||[]).map((p)=>p.now+' → '+p.want).join(', ')},
  'no-prod-keys':{t:'prod.keys 가 없어 스위치 게임 파일을 분석할 수 없습니다',d:'지금은 파일 이름의 [타이틀ID][vN] 로만 게임을 알아봅니다. 이름에 ID 가 없는 파일은 어떤 게임인지 모르고, 파일에서 이름과 아이콘 읽기, NSZ 변환, 홈 화면 바로가기를 쓸 수 없습니다. 레트로, 홈브류, 세이브, 패치는 그대로 씁니다. 설정 탭에서 자기 기기에서 덤프한 prod.keys 를 올리면 다시 시작하지 않아도 바로 적용됩니다.',go:['설정에서 올리기','settings']},
  'admin-2fa-skipped':{t:'2단계 인증 없이 관리 페이지가 열립니다',d:'셋업에서 인증 앱을 건너뛰어 관리자 계정 비밀번호만 알면 누구든 이 서버를 관리할 수 있습니다. 설정 탭에서 인증 앱을 등록합니다.',go:['설정에서 등록','settings/security']},
  'admin-unenrolled':{t:'관리 페이지 2단계 인증이 아직 등록되지 않았습니다',d:'인증 앱을 등록하면 관리자 비밀번호 다음에 6자리 코드를 한 번 더 묻습니다. 설정 탭에서 QR 을 찍어 등록합니다.',go:['설정에서 등록','settings/security']},
  'admin-authenticator-optional':{t:'관리 페이지는 관리자 비밀번호로만 들어갑니다',d:'인증 앱을 등록하면 비밀번호 대신 6자리 코드로도 들어갈 수 있습니다. 꼭 해야 하는 것은 아닙니다.',go:['설정에서 등록','settings/security']},
  'no-auth':{t:'주소를 아는 누구나 서버에 접속할 수 있습니다',d:'계정이 없고 기기 승인도 꺼져 있습니다. 계정 탭에서 계정을 하나 만들면 그때부터 로그인이 필요합니다.',go:['계정 만들기','users']},
  'proxy-collapse':{t:'프록시를 거쳐 오는데 COOK_TRUST_PROXY 가 없습니다',d:'모든 접속이 프록시 하나의 IP 로 보여 한 사람의 로그인 실패가 모두를 잠글 수 있습니다. compose 에 COOK_TRUST_PROXY 를 넣고 프록시가 X-Forwarded-For 를 넘기게 합니다.'},
  'both-lanes':{t:'계정과 기기 승인을 함께 씁니다',d:'콘솔은 승인된 기기 키로 접속하고, 대시보드는 계정으로 로그인합니다.'},
};
function renderWarnings(list){const box=$('warnings');box.replaceChildren();
  for(const w of list){const k=WARNINGS[w.code];const n=el('div',null,'note'+(w.severity==='warn'?' warn':''));
    n.append(el('div',k?.t??w.title,'t'),el('div',(typeof k?.d==='function'?k.d(w):k?.d)??w.detail,'d'));
    if(k?.go){const b=btn(k.go[0],()=>{location.hash='#'+k.go[1];});b.classList.add('note-go');n.append(b);}
    box.append(n);}}
function renderLanes(l){const box=$('lanes');box.replaceChildren();
  box.append(pill('계정: '+(l.accounts.enabled?l.accounts.userCount+'명':'없음'),l.accounts.enabled?'on':'off'));
  box.append(pill('기기 승인: '+(l.pairing.enabled?'켜짐':'꺼짐'),l.pairing.enabled?'on':''));
  if(l.pairingOnly)box.append(pill('승인된 기기만 받을 수 있음','warn'));
  box.append(pill('관리자 2단계 인증: '+(l.admin.enrolled?'등록됨':'등록 안 됨'),l.admin.enrolled?'on':'off'));}
// Where game names come from (titledb, the files' own data): the operator's view of what the web page used to show.
async function loadHealth(){
  let nh=null;try{const r=await fetch('/healthz',{headers:{Accept:'application/json'}});nh=(await r.json().catch(()=>null))?.nameHealth;}catch{}
  const box=$('health');box.replaceChildren();if(!nh)return;
  const v=nh.verdict==='filename-only'?['게임 이름: 파일 이름으로 대신하는 중','off']:nh.verdict==='degraded'?['게임 이름: 일부만 찾음','warn']:['게임 이름: 정상','on'];
  box.append(pill(v[0],v[1]));
  const tdb=nh.titledb||{};box.append(pill('titledb '+num(tdb.titles||0)+'개'+((tdb.regions||[]).length?' · 지역 '+tdb.regions.length+'곳':''),(tdb.titles||0)>0?'on':'off'));
  const ex=nh.extraction||{};
  box.append(pill('NSP/XCI 추출: '+(ex.mode==='off'?'꺼짐':!ex.nstool?'nstool 없음':!ex.prodKeys?'prod.keys 없음':'켜짐 · 키 확인됨'),ex.nspXciCapable?'on':'off'));
  const hint=$('health-hint');hint.hidden=nh.verdict!=='filename-only';
  hint.textContent='titledb 를 받지 못했고 서버에 prod.keys 도 없어 파일 이름으로 게임 이름을 대신합니다. 서버가 github 에 닿게 하거나 prod.keys 를 넣습니다.';}
function renderCards(d){const cards=$('cards');cards.replaceChildren();
  const card=(l,v,alert)=>{const c=el('div',null,'card'+(alert?' alert':''));c.append(el('div',num(v),'v'),el('div',l,'l'));return c;};
  cards.append(card('사용자',d.totals.configuredUsers),card('누적 요청',d.totals.totalRequests),
    card('차단된 IP',d.totals.lockouts,d.totals.lockouts>0),card('24시간 거부',d.totals.denied24h,d.totals.denied24h>0));}

function showShopUrl(){$('shop-url').textContent=location.origin.replace(/[/]$/,'');}
$('shop-url-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shop-url').textContent);toast('주소를 복사했습니다');}catch{toast('복사하지 못했습니다. 주소를 직접 고릅니다');}});
showShopUrl();

async function loadOverview(){
  try{const d=await api('/admin/api/stats');
    $('ts').textContent=topFill('overview.asOf',{at:fmt(d.generatedAt)});
    renderWarnings(d.warnings||[]);renderLanes(d.lanes);renderCards(d);await loadHealth();
  }catch(err){if(err.message!=='session')toast(errText(err));}}
`;
