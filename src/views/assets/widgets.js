import { safeUrl } from "./catalog.js";
const translations = {
  ko: {
    skip:"본문으로 이동",home:"홈",search:"검색",library:"모든 게임",updates:"업데이트",downloads:"다운로드",settings:"설정",server:"원격 서버",
    loading:"게임을 불러오고 있습니다.",all:"전체",korean:"한국어 지원",withUpdate:"업데이트 있음",withDlc:"DLC 있음",sortRecent:"정렬: 최근 추가순",sortName:"정렬: 이름순",sortRelease:"정렬: 출시일순",sortSize:"정렬: 용량순",
    queueAll:"모두 다운로드에 추가",updatesNote:"서버에 있는 최신 업데이트와 DLC를 보여 줍니다. 웹에서는 스위치에 설치된 버전을 확인할 수 없습니다.",downloadNote:"파일마다 다운로드를 눌러 PC에 저장합니다. 완료 여부와 저장 위치는 브라우저에서 확인합니다.",
    uploadTitle:"서버에 파일 추가",uploadDrop:"파일을 끌어 놓거나 선택합니다.",connectTitle:"원격 서버 추가",connectNote:"설정 파일을 switch/cookingfoil에 넣습니다. 기기 승인이 필요한 샵은 스위치에 표시된 QR로 인증합니다.",downloadConfig:"설정 파일 받기",copy:"주소 복사",refresh:"다시 읽기",language:"언어",version:"서버 버전",manage:"서버 관리",openAdmin:"관리 화면 열기",serverInfo:"서버 정보",select:"선택",back:"뒤로",
    chooseFiles:"다운로드할 항목",total:"합계",queue:"다운로드에 추가",webNote:"스위치에 설치하려면 CookingFoil 클라이언트를 사용합니다.",otherFiles:"다른 파일",newGame:"새로 들어온 게임",featured:"추천 게임",recent:"최근 추가",seeAll:"모두 보기",update:"업데이트",base:"본편",latest:"최신",extra:"추가 콘텐츠",noDesc:"소개가 아직 없습니다.",titleId:"타이틀 ID",format:"파일 형식",release:"출시일",players:"플레이 인원",download:"다운로드",remove:"제거",moveUp:"위로",moveDown:"아래로",
    noGames:"표시할 게임이 없습니다.",noResults:"조건에 맞는 게임이 없습니다.",noUpdates:"서버에 업데이트나 DLC가 없습니다.",noQueue:"상세 화면에서 필요한 파일을 다운로드에 추가합니다.",added:"다운로드에 추가했습니다.",copied:"서버 주소를 복사했습니다.",copyFailed:"주소를 선택해 복사해 주세요.",loadFailed:"서버에 연결하지 못했습니다. 설정에서 다시 읽기를 눌러 주세요.",requested:"브라우저에 다운로드를 요청했습니다.",requestedState:"다운로드 요청됨",pending:"대기 중",updated:"서버 목록을 다시 읽었습니다.",games:"게임",files:"파일",metadata:"타이틀 메타데이터",unknown:"정보 없음",connected:"연결했습니다",connecting:"연결하고 있습니다",retry:"다시 연결합니다",
    apply:"목록에 반영",delete:"삭제",uploadEmpty:"대기 중인 업로드가 없습니다.",uploadFailed:"업로드하지 못했습니다.",applied:"서버 목록에 반영했습니다.",deleted:"파일을 삭제했습니다.",artTitle:"게임 이미지 관리",icon:"아이콘",banner:"배너",screens:"스크린샷",replace:"교체",add:"추가",saved:"이미지를 저장했습니다.",failed:"처리하지 못했습니다.",downloadMissing:"서버 목록에서 이 파일을 찾지 못했습니다. 다시 읽은 뒤 확인해 주세요.",
    searchPlaceholder:"게임 이름으로 찾기",previous:"이전",next:"다음",unknownPublisher:"배포사 정보 없음",downloadHelp:"다운로드 요청 후 브라우저가 파일을 저장합니다.",trailers:"게임 영상",playTrailer:"미리보기 재생",
  },
  en: {
    skip:"Skip to content",home:"Home",search:"Search",library:"All games",updates:"Updates",downloads:"Downloads",settings:"Settings",server:"Remote server",
    loading:"Loading games.",all:"All",korean:"Korean support",withUpdate:"With updates",withDlc:"With DLC",sortRecent:"Sort: recently added",sortName:"Sort: name",sortRelease:"Sort: release date",sortSize:"Sort: size",
    queueAll:"Add all to downloads",updatesNote:"Latest updates and DLC available on the server. The website cannot read versions installed on your Switch.",downloadNote:"Download each file to your PC. Check completion and the save location in your browser.",
    uploadTitle:"Add files to the server",uploadDrop:"Drop a file here or choose one.",connectTitle:"Add remote server",connectNote:"Place the configuration file in switch/cookingfoil. For shops requiring device approval, scan the QR shown on your Switch.",downloadConfig:"Get configuration",copy:"Copy address",refresh:"Reload",language:"Language",version:"Server version",manage:"Server administration",openAdmin:"Open admin",serverInfo:"Server information",select:"Select",back:"Back",
    chooseFiles:"Files to download",total:"Total",queue:"Add to downloads",webNote:"Use the CookingFoil client to install on your Switch.",otherFiles:"Other files",newGame:"New arrival",featured:"Featured game",recent:"Recently added",seeAll:"View all",update:"Update",base:"Base game",latest:"Latest",extra:"Additional content",noDesc:"No description available yet.",titleId:"Title ID",format:"File format",release:"Release date",players:"Players",download:"Download",remove:"Remove",moveUp:"Move up",moveDown:"Move down",
    noGames:"No games available.",noResults:"No games match your filters.",noUpdates:"No updates or DLC available on the server.",noQueue:"Choose files on a game's detail screen to add them here.",added:"Added to downloads.",copied:"Server address copied.",copyFailed:"Select and copy the address.",loadFailed:"Could not connect. Open Settings and reload.",requested:"Download requested in your browser.",requestedState:"Download requested",pending:"Waiting",updated:"Server catalog reloaded.",games:"Games",files:"Files",metadata:"Title metadata",unknown:"Unknown",connected:"Connected",connecting:"Connecting",retry:"Reconnecting",
    apply:"Add to catalog",delete:"Delete",uploadEmpty:"No pending uploads.",uploadFailed:"Could not upload the file.",applied:"Added to the server catalog.",deleted:"File deleted.",artTitle:"Manage artwork",icon:"Icon",banner:"Banner",screens:"Screenshots",replace:"Replace",add:"Add",saved:"Artwork saved.",failed:"Could not complete the request.",downloadMissing:"This file is no longer in the server catalog. Reload and check again.",
    searchPlaceholder:"Search game names",previous:"Previous",next:"Next",unknownPublisher:"Publisher unknown",downloadHelp:"Your browser saves the file after the download request.",trailers:"Game videos",playTrailer:"Play trailer",
  },
};
export const $ = (id) => document.getElementById(id);
export function readSaved(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private sessions can disable storage. */ } }
let lang = readSaved("cookingfoil:eshop-lang", navigator.language.startsWith("ko") ? "ko" : "en");
if (!translations[lang]) lang = "ko";
export const language = () => lang;
export const t = (key) => translations[lang][key] || key;
export function setLanguage(value) { if (translations[value]) { lang = value; save("cookingfoil:eshop-lang", value); } }
export function translate() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-lang]").forEach((el) => {
    if (el instanceof HTMLButtonElement) el.setAttribute("aria-pressed", String(el.dataset.lang === lang));
  });
  $("search").placeholder = t("searchPlaceholder");
  $("search").setAttribute("aria-label", t("searchPlaceholder"));
  document.querySelectorAll(".nav-item").forEach((el) => el.setAttribute("aria-label", t(el.dataset.view === "search" ? "search" : el.dataset.view)));
}
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function button(text, action, className = "button secondary") {
  const b = el("button", className, text); b.type = "button"; b.addEventListener("click", action); return b;
}
const placeholder = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="24" fill="#E2E0DA"/><rect x="76" y="98" width="104" height="60" rx="12" fill="#FFC23D" stroke="#16161A" stroke-width="5"/><path d="M84 109h88" stroke="#FFE08A" stroke-width="14"/></svg>');
export function image(url, className = "cover") {
  const node = el("img", className); node.alt = ""; node.decoding = "async"; node.loading = className === "hero-bg" ? "eager" : "lazy";
  node.onerror = () => { node.onerror = null; node.src = placeholder; };
  node.src = safeUrl(url) || placeholder;
  return node;
}
export function setImage(node, url) { node.onerror = () => { node.onerror = null; node.src = placeholder; }; node.src = safeUrl(url) || placeholder; }
export function badges(group) {
  const box = el("div", "badges");
  if (group.update) box.append(el("span", "pill", t("update")));
  if (group.dlc.length) box.append(el("span", "pill", "DLC " + group.dlc.length));
  return box;
}
export function card(group, action) {
  const node = button("", () => action(group), "game");
  node.setAttribute("aria-label", group.name);
  const icon = group.icon ? group.icon + (group.icon.includes("?") ? "&" : "?") + "size=sm" : "";
  node.append(image(icon), el("div", "name", group.name), badges(group));
  node.title = group.name;
  return node;
}
export function toast(text) {
  const node = el("div", "toast", text); $("toasts").append(node); setTimeout(() => node.remove(), 5000);
}
export function empty(box, key) { box.replaceChildren(el("div", "empty", t(key))); }
export { translations };
