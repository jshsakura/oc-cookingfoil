/**
 * The overview tab's "연결" lines: how each kind of client joins this server,
 * written from the settings in force when the page is drawn, so the page never
 * tells the admin a way in that the server would refuse.
 *
 *   devicePairing             CookingFoil joins by QR (or as a client downloaded from the web page)
 *   deviceApproval            who approves a QR request
 *   consolePasswords          ID and password consoles (CyberFoil, Tinfoil) are let in at all
 *   passwordsOn()             an account's own password counts, or only the per-device logins
 *   consolePasswordsLanOnly   those passwords only count from the home network
 */
import * as env from "../../helpers/envs.js";
import { passwordsOn } from "../../security/password-policy.js";

const APPROVAL = {
  manual: " 승인은 관리자가 기기 탭의 승인 대기에서 합니다.",
  signin: "",
  all: " 지금은 연결을 요청하는 기기를 모두 바로 승인합니다.",
};

/** The <li> lines for the current settings. `s` stands in for the live settings in tests. */
export function connectHowto(s = {
  devicePairing: env.devicePairing,
  deviceApproval: env.deviceAutoApproveAll ? "all" : env.deviceAutoApprove ? "signin" : "manual",
  consolePasswords: env.consolePasswords,
  accountPasswords: passwordsOn(),
  lanOnly: env.consolePasswordsLanOnly,
}) {
  const cookingfoil = s.devicePairing
    ? `<b>CookingFoil</b>: 웹 페이지에서 받은 앱은 처음 실행하면 이 서버에 바로 연결됩니다. 앱에 위 주소를 직접 넣으면 기기 화면에 QR 이 뜨고, 휴대폰으로 찍어 로그인하면 승인됩니다. 아이디와 비밀번호는 넣지 않습니다.${APPROVAL[s.deviceApproval] ?? ""}`
    : "<b>CookingFoil</b>: QR 연결을 꺼 두어 CyberFoil 과 같은 방식으로 아이디와 비밀번호를 넣어 접속합니다.";
  if (!s.consolePasswords) {
    return [cookingfoil, "<b>CyberFoil</b>, <b>Tinfoil</b>: 비밀번호로 접속하는 콘솔을 꺼 두어 지금은 접속할 수 없습니다. 설정 탭의 서버 동작에서 켭니다."];
  }
  const login = s.accountPasswords
    ? "계정 아이디와 비밀번호, 또는 기기 탭의 '기기별 접속 정보'에서 만든 아이디와 비밀번호"
    : "기기 탭의 '기기별 접속 정보'에서 만든 아이디와 비밀번호(계정 비밀번호는 받지 않습니다)";
  const where = s.lanOnly ? " 집 안 네트워크에서만 접속됩니다." : "";
  return [
    cookingfoil,
    `<b>CyberFoil</b>: 설정의 주소(URL) 칸에 위 주소를 넣고, 사용자 이름과 비밀번호 칸에 ${login}를 넣습니다. 기기별 접속 정보는 처음 접속한 기기 하나에만 묶이고 언제든 끊을 수 있습니다.${where}`,
    `<b>Tinfoil</b>(호환): File Browser 에서 + 로 위 주소를 넣고, 같은 아이디와 비밀번호를 넣습니다. 목록을 읽고 받는 호환 경로만 제공합니다.${where}`,
  ];
}
