/**
 * The settings tab's "outside services" panel: one card per service with what
 * it is for, where to get its key, and the form to save and test it.
 * Talks to /admin/api/integrations (integrations-api.js).
 */

import { box } from "./boxes.js";

const SERVICES = [
  {
    id: "igdb",
    title: "IGDB 평점",
    use: "평점을 모을 때 Steam 에 더해 IGDB 평점도 가져옵니다. 없으면 Steam 평점만 씁니다.",
    steps: [
      'Twitch 계정에 2단계 인증을 켭니다. 꺼져 있으면 앱을 등록할 수 없습니다.',
      '<a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener">dev.twitch.tv/console/apps</a> 에서 애플리케이션을 등록합니다. OAuth 리디렉션 URL 은 <code>http://localhost</code>, 분류는 Application Integration, 클라이언트 유형은 기밀로 고릅니다.',
      "만든 앱의 클라이언트 ID 를 복사하고, 새 시크릿을 만들어 둘 다 아래에 넣습니다.",
    ],
    fields: [["clientId", "클라이언트 ID"], ["clientSecret", "클라이언트 시크릿", true]],
  },
  {
    id: "steamgriddb",
    title: "SteamGridDB 표지",
    use: "표지와 아이콘 후보를 검색합니다. 자동으로 맞지 않은 항목을 직접 맞출 때 씁니다.",
    steps: [
      '<a href="https://www.steamgriddb.com" target="_blank" rel="noopener">steamgriddb.com</a> 에 Steam 계정으로 로그인합니다.',
      '<a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noopener">설정의 API 화면</a>에서 API 키를 만들어 아래에 넣습니다.',
    ],
    fields: [["apiKey", "API 키", true]],
  },
  {
    id: "retroAchievements",
    title: "RetroAchievements 업적",
    use: "레트로 게임마다 업적 목록과 플레이어의 달성 현황을 보여 줍니다. 키는 이 서버에 하나만 있으면 되고, 플레이어는 RetroAchievements 아이디만 등록합니다.",
    steps: [
      '<a href="https://retroachievements.org" target="_blank" rel="noopener">retroachievements.org</a> 에 가입하고 로그인합니다.',
      '<a href="https://retroachievements.org/settings" target="_blank" rel="noopener">설정 화면</a>의 Keys 에서 Web API Key 를 복사해 아래에 넣습니다.',
    ],
    fields: [["apiKey", "Web API 키", true]],
  },
  {
    id: "dropbox",
    title: "Dropbox 세이브 동기화",
    use: "클라이언트가 세이브를 Dropbox 와 맞출 수 있게 로그인을 이어 줍니다. 앱 키만 쓰고 시크릿은 필요 없습니다.",
    steps: [
      '<a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">dropbox.com/developers/apps</a> 에서 앱을 만듭니다. Scoped access, App folder 를 고릅니다.',
      "Permissions 탭에서 files.content.read 와 files.content.write 를 켜고 저장합니다.",
      "Settings 탭의 Redirect URIs 에 아래 주소를 등록합니다. 이 주소는 휴대폰에서 열 수 있는 https 주소여야 합니다. 다르면 아래 공개 주소 칸에 그 주소를 넣습니다.",
      "App key 를 아래에 넣습니다.",
    ],
    fields: [["appKey", "App key"], ["redirectBase", "공개 주소 (선택, https://…)"]],
    redirect: true,
  },
  {
    id: "github",
    title: "GitHub 토큰",
    use: "표지·베젤 목록과 홈브류 새 버전을 GitHub 에서 읽습니다. 토큰이 없으면 이 서버 전체가 시간당 60번으로 막혀, 한도에 걸리면 베젤을 다른 지역판으로 폴백하지 못하고 홈브류 확인도 미뤄집니다. 토큰을 넣으면 시간당 5,000번이 됩니다. 권한은 하나도 주지 않아도 됩니다.",
    steps: [
      '<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com 의 새 토큰 화면</a>에서 Fine-grained 토큰을 만듭니다.',
      "Repository access 는 Public repositories 로 두고 권한은 추가하지 않습니다. 만든 토큰을 아래에 넣습니다.",
    ],
    fields: [["token", "토큰", true]],
  },
];

// Services the server uses without a key, so the admin sees everything it talks to.
const KEYLESS = [
  ["titledb", "게임 정보", "게임 이름, 설명, 표지, 출시일을 읽습니다.", "github.com/blawar/titledb", "https://github.com/blawar/titledb"],
  ["eshopPrices", "공식 스토어 가격", "게임 상세에 공식 스토어 가격을 보여 줍니다.", "api.ec.nintendo.com", null],
  ["eshopPopularity", "공식 스토어 인기순", "인기순 정렬에 쓰는 순위를 공식 스토어 검색에서 읽습니다. 공개 검색 키가 들어 있어 따로 넣을 키가 없습니다.", "algolia.net", null],
  ["steam", "Steam 평점", "평점을 모을 때 Steam 사용자 평가를 읽습니다.", "store.steampowered.com", null],
  ["libretro", "레트로 표지", "레트로 게임의 표지와 스크린샷을 받습니다.", "github.com/libretro-thumbnails", "https://github.com/libretro-thumbnails"],
  ["bezel", "레트로 베젤", "레트로 게임 화면 둘레의 베젤 그림을 받습니다.", "github.com/thebezelproject", "https://github.com/thebezelproject"],
  ["launchbox", "레트로 평점", "레트로 게임 평점을 LaunchBox Games Database 에서 받습니다.", "gamesdb.launchbox-app.com", "https://gamesdb.launchbox-app.com"],
  ["releases", "홈브류 새 버전", "따라가는 저장소의 GitHub 릴리스를 확인합니다. 키 없이도 되지만 위 GitHub 토큰을 넣으면 한도가 넉넉해집니다.", "api.github.com", null],
  ["google", "구글 로그인", "웹 로그인에 씁니다. 클라이언트 ID 와 시크릿은 이 탭 아래의 구글 로그인 설정에서 넣습니다.", "accounts.google.com", null],
];

const card = (s) => `<div class="intg" data-svc="${s.id}">
  <div class="intg-hd"><h3>${s.title}</h3><span class="intg-state" data-state></span></div>
  <p class="muted">${s.use}</p>
  <ol class="intg-steps">${s.steps.map((x) => `<li>${x}</li>`).join("")}</ol>
  ${s.redirect ? '<div class="copy-row"><code data-redirect>불러오고 있습니다</code></div>' : ""}
  <form class="add" autocomplete="off">
    ${s.fields.map(([k, label, secret]) => `<input name="${k}" ${secret ? 'type="password" autocomplete="new-password"' : 'spellcheck="false"'} placeholder="${label}" aria-label="${label}" maxlength="300">`).join("")}
    <button class="primary" type="submit">저장</button>
    <button type="button" data-test>연결 확인</button>
    <button type="button" class="danger" data-clear>삭제</button>
  </form>
  <p class="muted" data-msg></p>
</div>`;

const keyless = ([id, title, use, host, href]) => `<div class="intg-free" data-free="${id}">
  <div class="intg-hd"><h3>${title}</h3><span class="intg-state on" data-free-state>키 필요 없음</span></div>
  <p class="muted">${use} <span class="intg-host">${href ? `<a href="${href}" target="_blank" rel="noopener">${host}</a>` : host}</span></p>
</div>`;

export const INTEGRATIONS_HTML = `<h2>외부 서비스 키</h2>
<p class="muted">키는 이 서버의 데이터 폴더에만 저장하고 화면에는 다시 보여 주지 않습니다. 저장하면 바로 적용합니다. 지우면 compose 환경변수에 넣은 값이 있을 때 그 값으로 돌아갑니다.</p>
${SERVICES.map(card).join("\n")}
${box("keyless", "키 없이 쓰는 외부 서비스", `<p class="muted">이 서버가 키 없이 읽어 오는 곳입니다. 넣을 것은 없고, 무엇에 쓰는지 확인하는 용도입니다.</p>
<div class="intg-frees">${KEYLESS.map(keyless).join("\n")}</div>`, { meta: "넣을 것 없이 확인만 합니다" })}`;

export const INTEGRATIONS_CSS = `
.intg{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:12px}
.intg-hd{display:flex;align-items:center;gap:10px;justify-content:space-between}.intg h3{margin:0;font-size:15px}
.intg-state{font-size:12px;font-weight:700;padding:3px 10px;border-radius:100px;background:var(--sunk);color:var(--muted)}
.intg-state.on{color:var(--good)}
.intg-steps{margin:6px 0 12px;padding-left:20px;color:var(--muted);font-size:13px}.intg-steps li{margin-bottom:4px}
.intg-steps code{font-size:12px}
.intg-frees{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.intg-free{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 16px}.intg-free h3{margin:0;font-size:14px}
.intg-free p{margin:6px 0 0;font-size:13px}.intg-host{display:block;margin-top:4px;font-size:12px;word-break:break-all}
.intg-state.off{color:var(--muted)}
`;

export const INTEGRATIONS_SCRIPT = /* js */ `
const INTG_SOURCE={admin:'관리 페이지에서 저장',env:'환경변수 사용 중',none:'꺼져 있음'};
async function loadIntegrations(){
  try{const d=await api('/admin/api/integrations');
    document.querySelectorAll('.intg').forEach((c)=>{const s=d[c.dataset.svc];if(!s)return;
      const st=c.querySelector('[data-state]');st.textContent=s.configured?'켜짐 · '+INTG_SOURCE[s.source]:INTG_SOURCE.none;st.classList.toggle('on',s.configured);
      for(const [k,f] of Object.entries(s.fields)){const i=c.querySelector('input[name="'+k+'"]');if(!i)continue;
        if('value' in f)i.value=f.value||'';else{i.value='';i.placeholder=i.getAttribute('aria-label')+(f.set?' (저장되어 있습니다. 바꿀 때만 넣습니다)':'');}}
      const r=c.querySelector('[data-redirect]');if(r)r.textContent=d.dropboxRedirectUri||'';});
    for(const [k,on] of Object.entries(d.keyless||{})){const st=document.querySelector('[data-free="'+k+'"] [data-free-state]');
      if(st){st.textContent=on?'키 필요 없음 · 켜짐':'꺼져 있음';st.classList.toggle('on',on);st.classList.toggle('off',!on);}}
  }catch(err){toast(err.message);}
}
document.querySelectorAll('.intg').forEach((c)=>{const svc=c.dataset.svc;const msg=c.querySelector('[data-msg]');
  c.querySelector('form').addEventListener('submit',async(e)=>{e.preventDefault();
    const body=Object.fromEntries([...c.querySelectorAll('input[name]')].map((i)=>[i.name,i.value]));
    try{await api('/admin/api/integrations/'+svc,{method:'POST',body});msg.textContent='';toast('저장했습니다.');loadIntegrations();}catch(err){msg.textContent=err.message;}});
  c.querySelector('[data-test]').addEventListener('click',async()=>{msg.textContent='확인하고 있습니다';
    try{const r=await api('/admin/api/integrations/'+svc+'/test',{method:'POST',body:{}});msg.textContent=r.message;}catch(err){msg.textContent=err.message;}});
  c.querySelector('[data-clear]').addEventListener('click',async()=>{if(!await ask('저장한 키를 삭제할까요?'))return;
    try{await api('/admin/api/integrations/'+svc+'/clear',{method:'POST',body:{}});toast('삭제했습니다.');loadIntegrations();}catch(err){msg.textContent=err.message;}});
});
`;
