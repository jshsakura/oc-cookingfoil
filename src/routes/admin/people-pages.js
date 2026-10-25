/**
 * The admin's people pages: the accounts and devices sections, and the
 * one-time credential and IP dialogs they carry. Exported here so the split
 * pages and the whole-page dashboard share the same markup.
 */
import { icon } from "../../views/icons.js";
import { top, topN, TOP_WORDS } from "./top-i18n.js";
import { box } from "./boxes.js";
import { enrollPerHour } from "../../helpers/envs.js";

/** The accounts section: local accounts plus Google sign-in approval. */
export const USERS_HTML = /* html */ `<section id="tab-users" hidden>
  <div class="subtabs hide-bar" id="users-subtabs" role="tablist" aria-label="사용자 구역">
    <button type="button" role="tab" data-sub="local" aria-selected="true">${icon("users")}계정</button>
    <button type="button" role="tab" data-sub="google" aria-selected="false">${icon("lock")}구글 로그인 계정<span class="count" id="account-sub-count" hidden></span></button>
  </div>
  <div data-sub-panel="local">
  <form class="add" id="add-user">
    <input id="new-name" autocomplete="off" placeholder="사용자 이름 (영문, 숫자, . _ -)" aria-label="사용자 이름" required maxlength="32">
    <input id="new-pass" type="password" autocomplete="new-password" placeholder="비밀번호 (비우면 자동 생성)" aria-label="비밀번호" maxlength="128">
    <select id="new-role" aria-label="역할"><option value="user">일반 사용자</option><option value="admin">관리자</option></select>
    <button class="primary" type="submit">사용자 추가</button>
  </form>
  <div class="scroll" id="users" data-skel></div>
  ${box("users-help", "계정 안내", `<p class="muted">웹은 이 계정으로 /login 에서 로그인합니다. 콘솔은 비밀번호로 접속하지 않고, 연결을 요청할 때 한 번 이 아이디와 비밀번호로 승인받을 수 있습니다. 관리자만 이 관리 페이지를 엽니다. 비밀번호는 만들거나 바꿀 때 한 번만 보여 주고 서버에는 해시만 남깁니다.</p>`, { level: "h3" })}
  </div>
  <div data-sub-panel="google" hidden>
  <p class="muted" id="accounthint"></p>
  <div class="scroll" id="accounts" data-skel></div>
  </div>
</section>`;

/** The devices section: pending, approved and issued-clients areas. */
export const DEVICES_HTML = /* html */ `<section id="tab-devices" hidden>
  <div class="subtabs hide-bar" id="devices-subtabs" role="tablist" aria-label="기기 구역">
    <button type="button" role="tab" data-sub="pending" aria-selected="true">${icon("bell")}승인 대기<span class="count" id="pending-sub-count" hidden></span></button>
    <button type="button" role="tab" data-sub="approved" aria-selected="false">${icon("device")}승인된 기기</button>
    <button type="button" role="tab" data-sub="clients" aria-selected="false">${icon("download")}웹에서 받은 클라이언트</button>
  </div>
  <div data-sub-panel="pending">
  <p class="muted" id="devhint"></p>
  <form class="add" id="approve-code">
    <input id="code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" data-top-ph="pp.devCodePh" placeholder="기기 화면의 기기 코드 8자리" aria-label="기기 코드" required maxlength="9">
    <input id="code-label" autocomplete="off" placeholder="기기 이름 (선택)" aria-label="기기 이름" maxlength="64">
    <button class="primary" type="submit">기기 코드로 승인</button>
  </form>
  <div class="scroll" id="pending" data-skel></div>
  </div>
  <div data-sub-panel="approved" hidden>
  <div class="add"><select id="dev-idle" data-top-label="acc.filter" aria-label="${TOP_WORDS.ko["acc.filter"]}">${["filterAll", "idle30", "idle60", "idle90"].map((k, i) =>
    `<option value="${i * 30}" data-top="acc.${k}">${TOP_WORDS.ko[`acc.${k}`]}</option>`).join("")}</select></div>
  <p class="muted">${top("acc.filterHint")}</p>
  <div class="scroll" id="devices" data-skel></div>
  </div>
  <div data-sub-panel="clients" hidden>
  <p class="muted">${topN("dev.clientsLead", enrollPerHour)}</p>
  <div class="scroll" id="clients" data-skel></div>
  <details class="ended-box" id="clients-ended-box" hidden><summary>만료되거나 취소한 항목 (<span id="clients-ended-count">0</span>)</summary><div class="scroll" id="clients-ended" data-skel></div></details>
  </div>
</section>`;

/** The one-time credential dialog: a new password shows once, then it is gone. */
export const CRED_DIALOG_HTML = /* html */ `<dialog id="cred-dialog" aria-labelledby="cred-title">
  <h3 id="cred-title"></h3>
  <p class="muted">이 비밀번호는 지금만 볼 수 있습니다. 창을 닫기 전에 전달합니다.</p>
  <div class="cred" id="cred"></div>
  <p class="muted">CookingFoil 은 설정 파일을 sdmc:/switch/cookingfoil/config.json 에 넣으면 처음 연결할 때 이 아이디와 비밀번호로 한 번 확인해 QR 없이 승인합니다. 그다음부터는 기기 키로 접속합니다.</p>
  <div class="dialog-actions">
    <button type="button" id="cred-config">CookingFoil 설정 파일 다운로드</button>
    <button type="button" class="primary" id="cred-close">닫기</button>
  </div>
</dialog>`;

/** The IP history dialog: where a console or an account connected from. */
export const IP_DIALOG_HTML = /* html */ `<dialog id="ip-dialog" aria-labelledby="ip-title">
  <h3 id="ip-title"></h3>
  <p class="muted" id="ip-hint"></p>
  <div class="ip-list" id="ip-list"></div>
  <div class="dialog-actions"><button type="button" class="primary" id="ip-close" data-top="acc.close"></button></div>
</dialog>`;
