/**
 * The overview tab's "연결" line: how a console joins this server, written
 * from the settings in force when the page is drawn, so the page never tells
 * the admin a way in that the server would refuse.
 *
 *   devicePairing    CookingFoil joins by QR (or as a client downloaded from the web page)
 *   deviceApproval   who approves a QR request
 *   passwordsOn()    whether an ID and password given at pairing approves the console at once
 */
import * as env from "../../helpers/envs.js";
import { passwordsOn } from "../../security/password-policy.js";

const APPROVAL = {
  manual: " 승인은 관리자가 기기 탭의 승인 대기에서 합니다.",
  signin: "",
  all: " 지금은 연결을 요청하는 기기를 모두 바로 승인합니다.",
};

const ONE_TIME_PASSWORD = " 앱에 아이디와 비밀번호를 넣어 두면 연결할 때 한 번만 확인해 바로 승인하고, 그 뒤로는 기기 키로만 접속합니다.";

/** The <li> lines for the current settings. `s` stands in for the live settings in tests. */
export function connectHowto(s = {
  devicePairing: env.devicePairing,
  deviceApproval: env.deviceAutoApproveAll ? "all" : env.deviceAutoApprove ? "signin" : "manual",
  accountPasswords: passwordsOn(),
}) {
  if (!s.devicePairing) return ["<b>CookingFoil</b>: QR 연결을 꺼 두어 지금은 콘솔이 접속할 수 없습니다. 설정 탭의 기기 연결에서 켭니다."];
  const password = s.deviceApproval === "signin" && s.accountPasswords ? ONE_TIME_PASSWORD : " 콘솔은 비밀번호를 쓰지 않습니다.";
  return [`<b>CookingFoil</b>: 웹 페이지에서 받은 앱은 처음 실행하면 이 서버에 바로 연결됩니다. 앱에 위 주소를 직접 넣으면 기기 화면에 QR 이 뜨고, 휴대폰으로 찍어 로그인하면 승인됩니다.${password}${APPROVAL[s.deviceApproval] ?? ""}`];
}
