/**
 * Homebrew the admin page offers to follow in one go. Each was checked on
 * 2026-10-12 to publish a usable build (.nro, or a .zip with one inside) in
 * its latest GitHub release; `purpose` is what it is for, per language.
 */
const P = (ko, en, ja, zh) => ({ ko, en, ja, zh });

export const RECOMMENDED = [
  { repo: "murat303/ytb-player", purpose: P("유튜브", "YouTube", "YouTube", "YouTube") },
  { repo: "mirusu400/switch-newpipe", purpose: P("유튜브 (YTB Player 의 원본)", "YouTube (YTB Player's origin)", "YouTube（YTB Player の元）", "YouTube（YTB Player 的原版）") },
  { repo: "xfangfang/wiliwili", purpose: P("빌리빌리", "Bilibili", "ビリビリ", "哔哩哔哩") },
  { repo: "proconsule/nxmp", purpose: P("동영상 플레이어", "Video player", "動画プレーヤー", "视频播放器") },
  { repo: "dragonflylee/switchfin", purpose: P("Jellyfin", "Jellyfin", "Jellyfin", "Jellyfin") },
  { repo: "XITRIX/Moonlight-Switch", purpose: P("PC 화면 스트리밍", "PC streaming", "PC 画面ストリーミング", "PC 串流") },
  { repo: "J-D-K/JKSV", purpose: P("세이브 백업", "Save backup", "セーブのバックアップ", "存档备份") },
  { repo: "BernardoGiordano/Checkpoint", purpose: P("세이브 백업", "Save backup", "セーブのバックアップ", "存档备份") },
  { repo: "joel16/NX-Shell", purpose: P("파일 관리자", "File manager", "ファイルマネージャー", "文件管理器") },
  { repo: "mtheall/ftpd", purpose: P("FTP 서버", "FTP server", "FTP サーバー", "FTP 服务器") },
  { repo: "XorTroll/Goldleaf", purpose: P("파일·타이틀 관리", "Files and titles", "ファイル・タイトル管理", "文件与标题管理") },
  { repo: "DarkMatterCore/nxdumptool", purpose: P("덤프 도구", "Dump tool", "ダンプツール", "转储工具") },
  { repo: "ITotalJustice/sphaira", purpose: P("홈브류 메뉴", "Homebrew menu", "自作アプリメニュー", "自制程序菜单") },
  { repo: "fortheusers/hb-appstore", purpose: P("홈브류 스토어", "Homebrew store", "自作アプリストア", "自制程序商店") },
  { repo: "HamletDuFromage/aio-switch-updater", purpose: P("업데이트 도구", "Updater", "アップデーター", "更新工具") },
  { repo: "exelix11/SwitchThemeInjector", purpose: P("테마 설치", "Theme installer", "テーマのインストール", "主题安装") },
  { repo: "nadrino/SimpleModManager", purpose: P("모드 관리", "Mod manager", "MOD 管理", "模组管理") },
  { repo: "WerWolv/EdiZon", purpose: P("치트 관리", "Cheat manager", "チート管理", "金手指管理") },
  { repo: "averne/Fizeau", purpose: P("화면 색 보정", "Screen colour", "画面の色補正", "屏幕色彩调整") },
  { repo: "meganukebmp/Switch_90DNS_tester", purpose: P("90DNS 차단 확인", "90DNS check", "90DNS の確認", "90DNS 检查") },
];
