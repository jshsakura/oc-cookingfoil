/**
 * Every line a Telegram alert or its buttons say, in the four languages the
 * project ships (ko, en, ja, zh). The admin picks one on the alerts tab
 * (the telegram integration's `lang`, Korean by default).
 *
 * A caller hands alert() a function of `t` instead of a finished string:
 *   alert("server", (t) => t("serverStarted"))
 * and alerts.js renders it once in the chosen language. t(key, params) falls
 * back to Korean when a language lacks a key.
 */
export const LANGS = ["ko", "en", "ja", "zh"];
export const DEFAULT_LANG = "ko";

const M = {
  // Titles, after "[CookingFoil] "
  "event.device": { ko: "기기 승인 요청", en: "Console approval request", ja: "本体の承認リクエスト", zh: "主机批准请求" },
  "event.account": { ko: "구글 계정 승인 요청", en: "Google account approval request", ja: "Google アカウントの承認リクエスト", zh: "Google 账号批准请求" },
  "event.lockout": { ko: "로그인 실패 잠금", en: "Sign-in lockout", ja: "ログイン失敗によるロック", zh: "登录失败锁定" },
  "event.probe": { ko: "위험한 접근", en: "Suspicious access", ja: "危険なアクセス", zh: "可疑访问" },
  "event.inbox": { ko: "임시 공유", en: "Shared inbox", ja: "一時共有", zh: "临时共享" },
  "event.direct": { ko: "외부 다운로드 전용 주소", en: "External download address", ja: "外部ダウンロード専用アドレス", zh: "外部下载专用地址" },
  "event.nsz": { ko: "NSZ 변환", en: "NSZ conversion", ja: "NSZ 変換", zh: "NSZ 转换" },
  "event.server": { ko: "서버 시작", en: "Server started", ja: "サーバー起動", zh: "服务器启动" },
  "event.test": { ko: "알림 시험", en: "Alert test", ja: "通知テスト", zh: "通知测试" },

  serverStarted: { ko: "서버가 기동되었습니다.", en: "The server has started.", ja: "サーバーが起動しました。", zh: "服务器已启动。" },
  directStartUp: {
    ko: "외부 다운로드 전용 주소도 정상적으로 응답하고 있습니다.",
    en: "The external download address is answering normally too.",
    ja: "外部ダウンロード専用アドレスも正常に応答しています。",
    zh: "外部下载专用地址也在正常响应。",
  },
  directStartDown: {
    ko: "외부 다운로드 전용 주소는 아직 응답하지 않습니다.",
    en: "The external download address is not answering yet.",
    ja: "外部ダウンロード専用アドレスはまだ応答していません。",
    zh: "外部下载专用地址尚未响应。",
  },
  directDown: {
    ko: "외부 다운로드 전용 주소가 응답하지 않습니다.",
    en: "The external download address is not answering.",
    ja: "外部ダウンロード専用アドレスが応答していません。",
    zh: "外部下载专用地址没有响应。",
  },
  directUp: {
    ko: "외부 다운로드 전용 주소가 다시 정상적으로 응답합니다.",
    en: "The external download address is answering normally again.",
    ja: "外部ダウンロード専用アドレスが再び正常に応答しています。",
    zh: "外部下载专用地址已恢复正常响应。",
  },

  "probe.uri-too-long": { ko: "지나치게 긴 주소", en: "An overlong address", ja: "長すぎるアドレス", zh: "过长的地址" },
  "probe.control-char": { ko: "주소 안의 제어 문자", en: "A control character in the address", ja: "アドレス内の制御文字", zh: "地址中的控制字符" },
  "probe.path-traversal": { ko: "상위 폴더로 빠져나가려는 주소", en: "An address climbing out of its folder", ja: "上位フォルダーへ抜け出そうとするアドレス", zh: "试图跳出上级目录的地址" },
  "probe.bad-path": { ko: "알려진 공격 경로", en: "A known attack path", ja: "既知の攻撃パス", zh: "已知的攻击路径" },
  "probe.bad-ua": { ko: "공격 도구", en: "An attack tool", ja: "攻撃ツール", zh: "攻击工具" },
  probeBlocked: {
    ko: ({ what, where }) => `${what}: ${where} 를 로그인 전에 막았습니다.`,
    en: ({ what, where }) => `${what}: blocked ${where} before sign-in.`,
    ja: ({ what, where }) => `${what}: ${where} をログイン前にブロックしました。`,
    zh: ({ what, where }) => `${what}：已在登录前拦截 ${where}。`,
  },
  probeDigest: {
    ko: ({ mins, count, addresses, top }) => `지난 ${mins}분 동안 ${count}건을 더 막았습니다. 주소 ${addresses}곳에서 왔고, 많이 노린 경로는 ${top} 입니다.`,
    en: ({ mins, count, addresses, top }) => `Blocked ${count} more in the last ${mins} minutes, from ${addresses} addresses. Most tried: ${top}.`,
    ja: ({ mins, count, addresses, top }) => `直近 ${mins} 分間にさらに ${count} 件をブロックしました。送信元アドレスは ${addresses} 件、よく狙われたパスは ${top} です。`,
    zh: ({ mins, count, addresses, top }) => `过去 ${mins} 分钟内又拦截了 ${count} 次，来自 ${addresses} 个地址，最常尝试的路径：${top}。`,
  },

  lockout: {
    ko: "아이디나 비밀번호를 여러 번 틀린 주소를 잠갔습니다. 우리 기기라면 관리 화면의 로그 탭에서 풉니다.",
    en: "An address that got the ID or password wrong several times is locked out. If it is one of yours, unlock it on the admin page's log tab.",
    ja: "ID かパスワードを何度も間違えたアドレスをロックしました。自分の機器なら管理画面のログタブで解除します。",
    zh: "多次输错账号或密码的地址已被锁定。如果是自己的设备，请在管理页面的日志标签中解除。",
  },

  account: {
    ko: ({ email }) => `새 구글 계정이 들어왔습니다.\n계정: ${email}\n관리 화면의 사용자 탭에서 승인합니다.`,
    en: ({ email }) => `A new Google account signed in.\nAccount: ${email}\nApprove it on the admin page's users tab.`,
    ja: ({ email }) => `新しい Google アカウントがログインしました。\nアカウント: ${email}\n管理画面のユーザータブで承認します。`,
    zh: ({ email }) => `有新的 Google 账号登录。\n账号：${email}\n请在管理页面的用户标签中批准。`,
  },

  device: {
    ko: ({ code, note, lines }) => `기기 코드 ${code}\n${note ? `메시지: ${note}\n` : ""}${lines}콘솔 화면의 코드와 같은지 확인한 뒤 승인합니다.`,
    en: ({ code, note, lines }) => `Console code ${code}\n${note ? `Message: ${note}\n` : ""}${lines}Approve once it matches the code on the console's screen.`,
    ja: ({ code, note, lines }) => `本体コード ${code}\n${note ? `メッセージ: ${note}\n` : ""}${lines}本体の画面のコードと同じか確かめてから承認します。`,
    zh: ({ code, note, lines }) => `主机代码 ${code}\n${note ? `留言：${note}\n` : ""}${lines}请确认与主机屏幕上的代码一致后再批准。`,
  },
  deviceName: { ko: ({ name }) => `기기 이름: ${name}`, en: ({ name }) => `Console name: ${name}`, ja: ({ name }) => `本体の名前: ${name}`, zh: ({ name }) => `主机名称：${name}` },
  deviceOwner: {
    ko: ({ owner, how }) => `받은 계정: ${owner} (${how})`,
    en: ({ owner, how }) => `Downloaded by: ${owner} (${how})`,
    ja: ({ owner, how }) => `受け取ったアカウント: ${owner} (${how})`,
    zh: ({ owner, how }) => `下载账号：${owner}（${how}）`,
  },
  "download.used": { ko: "다른 기기에서 이미 쓴 다운로드", en: "a download already used on another console", ja: "別の本体で使用済みのダウンロード", zh: "已在其他主机上使用的下载" },
  "download.expired": { ko: "기한이 지난 다운로드", en: "an expired download", ja: "期限切れのダウンロード", zh: "已过期的下载" },
  "download.revoked": { ko: "취소된 다운로드", en: "a revoked download", ja: "取り消されたダウンロード", zh: "已撤销的下载" },
  "download.waiting": { ko: "다운로드", en: "a download", ja: "ダウンロード", zh: "下载" },
  requesterFrom: { ko: ({ ip, place }) => `보낸 곳: ${ip} (${place})`, en: ({ ip, place }) => `From: ${ip} (${place})`, ja: ({ ip, place }) => `送信元: ${ip} (${place})`, zh: ({ ip, place }) => `来源：${ip}（${place}）` },
  requesterAccounts: {
    ko: ({ names, more }) => `같은 주소에서 접속한 계정: ${names}${more ? ` 외 ${more}명` : ""}`,
    en: ({ names, more }) => `Accounts seen from the same address: ${names}${more ? ` and ${more} more` : ""}`,
    ja: ({ names, more }) => `同じアドレスから接続したアカウント: ${names}${more ? ` ほか ${more} 名` : ""}`,
    zh: ({ names, more }) => `同一地址登录过的账号：${names}${more ? ` 等另外 ${more} 个` : ""}`,
  },
  requesterApp: { ko: ({ app }) => `앱: ${app}`, en: ({ app }) => `App: ${app}`, ja: ({ app }) => `アプリ: ${app}`, zh: ({ app }) => `应用：${app}` },
  "place.server": { ko: "이 서버", en: "this server", ja: "このサーバー", zh: "本服务器" },
  "place.tailscale": { ko: "Tailscale", en: "Tailscale", ja: "Tailscale", zh: "Tailscale" },
  "place.home": { ko: "집 안", en: "home network", ja: "家庭内", zh: "家庭网络" },
  "place.outside": { ko: "집 밖", en: "outside", ja: "外部", zh: "外部" },
  moreWaiting: {
    ko: ({ count, kind }) => `${count}개 ${kind === "account" ? "계정이" : "기기가"} 더 승인을 기다립니다. 관리 페이지에서 확인합니다.`,
    en: ({ count, kind }) => `${count} more ${kind === "account" ? "accounts" : "consoles"} are waiting for approval. Check the admin page.`,
    ja: ({ count, kind }) => `さらに ${count} 件の${kind === "account" ? "アカウント" : "本体"}が承認を待っています。管理画面で確認します。`,
    zh: ({ count, kind }) => `还有 ${count} 个${kind === "account" ? "账号" : "主机"}在等待批准，请在管理页面查看。`,
  },

  inbox: {
    ko: ({ user, files, size, links, memo }) => `${user} 님이 파일 ${files}개(${size}), 링크 ${links}개를 올렸습니다.${memo ? `\n메모: ${memo}` : ""}`,
    en: ({ user, files, size, links, memo }) => `${user} shared ${files} files (${size}) and ${links} links.${memo ? `\nNote: ${memo}` : ""}`,
    ja: ({ user, files, size, links, memo }) => `${user} さんがファイル ${files} 件 (${size})、リンク ${links} 件を共有しました。${memo ? `\nメモ: ${memo}` : ""}`,
    zh: ({ user, files, size, links, memo }) => `${user} 分享了 ${files} 个文件（${size}）和 ${links} 个链接。${memo ? `\n备注：${memo}` : ""}`,
  },

  nszDrained: {
    ko: ({ done, saved, failed }) => `변환 대기열을 모두 처리했습니다. ${done}개를 변환해 ${saved}를 확보했습니다.${failed ? ` 실패 ${failed}개는 변환 탭에서 확인합니다.` : ""}`,
    en: ({ done, saved, failed }) => `The conversion queue is done: ${done} files converted, ${saved} freed.${failed ? ` ${failed} failed; see the conversion tab.` : ""}`,
    ja: ({ done, saved, failed }) => `変換キューをすべて処理しました。${done} 件を変換して ${saved} を確保しました。${failed ? `失敗した ${failed} 件は変換タブで確認します。` : ""}`,
    zh: ({ done, saved, failed }) => `转换队列已全部处理：转换 ${done} 个，节省 ${saved}。${failed ? `失败的 ${failed} 个请在转换标签中查看。` : ""}`,
  },
  nszNoSpace: {
    ko: ({ free, name, size }) => `남은 공간이 ${free}라 ${name}(${size})를 변환할 작업 공간이 모자라 멈췄습니다. 공간을 비운 뒤 변환 탭에서 다시 시작합니다.`,
    en: ({ free, name, size }) => `Paused: only ${free} free, not enough room to convert ${name} (${size}). Free some space, then start again on the conversion tab.`,
    ja: ({ free, name, size }) => `空き容量が ${free} しかなく、${name} (${size}) を変換する作業領域が足りないため停止しました。空きを作ってから変換タブで再開します。`,
    zh: ({ free, name, size }) => `剩余空间只有 ${free}，不足以转换 ${name}（${size}），已暂停。腾出空间后在转换标签中重新开始。`,
  },
  nszFailures: {
    ko: ({ count, reason }) => `변환이 ${count}번 잇달아 실패해 멈췄습니다. 마지막 이유: ${reason}`,
    en: ({ count, reason }) => `Paused after ${count} conversions failed in a row. Last reason: ${reason}`,
    ja: ({ count, reason }) => `変換が ${count} 回続けて失敗したため停止しました。最後の理由: ${reason}`,
    zh: ({ count, reason }) => `转换连续失败 ${count} 次，已暂停。最后原因：${reason}`,
  },

  testSent: {
    ko: ({ on }) => `알림 연결을 확인했습니다. 지금 받는 알림: ${on}`,
    en: ({ on }) => `The alert connection works. Alerts on now: ${on}`,
    ja: ({ on }) => `通知の接続を確認しました。いま受け取る通知: ${on}`,
    zh: ({ on }) => `通知连接正常。当前接收的通知：${on}`,
  },
  // Between two sentences: Japanese and Chinese run them together.
  gap: { ko: " ", en: " ", ja: "", zh: "" },
  none: { ko: "없음", en: "none", ja: "なし", zh: "无" },

  approveButton: { ko: "승인", en: "Approve", ja: "承認", zh: "批准" },
  refuseButton: { ko: "거절", en: "Refuse", ja: "拒否", zh: "拒绝" },
  spent: { ko: "이미 처리했거나 만료된 요청입니다", en: "This request was already handled or has expired", ja: "処理済みか期限切れのリクエストです", zh: "该请求已处理或已过期" },
  handled: { ko: "이미 관리 화면에서 처리한 요청입니다", en: "This request was already handled on the admin page", ja: "管理画面ですでに処理したリクエストです", zh: "该请求已在管理页面处理" },
  approved: { ko: "승인했습니다", en: "Approved", ja: "承認しました", zh: "已批准" },
  refusedDevice: { ko: "거절했습니다. 기기가 다시 요청하면 또 알립니다", en: "Refused. If the console asks again, you will hear again", ja: "拒否しました。本体がもう一度リクエストしたらまた通知します", zh: "已拒绝。主机再次请求时会再次通知" },
  refusedAccount: { ko: "거절했습니다. 계정은 사용 중지 상태가 됩니다", en: "Refused. The account is now disabled", ja: "拒否しました。アカウントは利用停止になります", zh: "已拒绝。该账号已停用" },
  otherChat: { ko: "이 대화에서는 처리할 수 없습니다", en: "This cannot be handled from this chat", ja: "この会話では処理できません", zh: "无法在此对话中处理" },
  notAllowed: { ko: "승인할 수 있는 사용자로 등록되지 않았습니다", en: "You are not listed as someone who may approve", ja: "承認できるユーザーとして登録されていません", zh: "您未被登记为可批准的用户" },
  someone: { ko: "누군가", en: "Someone", ja: "誰か", zh: "某人" },
  decidedBy: { ko: ({ who, line }) => `${who} 님이 ${line}.`, en: ({ who, line }) => `${who}: ${line}.`, ja: ({ who, line }) => `${who} さんが${line}。`, zh: ({ who, line }) => `${who}：${line}。` },
};

/** The translator for one language: t(key, params) → string. Pure. */
export function translator(lang = DEFAULT_LANG) {
  const l = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  return (key, params = {}) => {
    const entry = M[key];
    if (!entry) return key;
    const v = entry[l] ?? entry[DEFAULT_LANG];
    return typeof v === "function" ? v(params) : v;
  };
}

/** A message for alert(): a string as it is, or a function of `t` rendered in `lang`. Pure. */
export const render = (message, lang) => (typeof message === "function" ? message(translator(lang)) : String(message ?? ""));

/** Every key with every language, for the tests. */
export const keysForTests = () => Object.fromEntries(Object.entries(M).map(([k, v]) => [k, Object.keys(v)]));
