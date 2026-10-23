/**
 * Homebrew the admin page offers to follow in one go. Each was checked on
 * 2026-10-12 to publish a usable build (.nro, or a .zip with one inside) in
 * its latest GitHub release; `purpose` is what it is for, per language.
 * Installers and other stores (Goldleaf, DBI, hb-appstore) are never offered.
 */
export const RECOMMENDED = [
  { repo: "murat303/ytb-player", purpose: { ko: "유튜브", en: "YouTube", ja: "YouTube", zh: "YouTube" } },
  { repo: "mirusu400/switch-newpipe", purpose: { ko: "유튜브 (YTB Player 의 원본)", en: "YouTube (YTB Player's origin)", ja: "YouTube（YTB Player の元）", zh: "YouTube（YTB Player 的原版）" } },
  { repo: "xfangfang/wiliwili", purpose: { ko: "빌리빌리", en: "Bilibili", ja: "ビリビリ", zh: "哔哩哔哩" } },
  { repo: "proconsule/nxmp", purpose: { ko: "동영상 플레이어", en: "Video player", ja: "動画プレーヤー", zh: "视频播放器" } },
  { repo: "dragonflylee/switchfin", purpose: { ko: "Jellyfin", en: "Jellyfin", ja: "Jellyfin", zh: "Jellyfin" } },
  { repo: "XITRIX/Moonlight-Switch", purpose: { ko: "PC 화면 스트리밍", en: "PC streaming", ja: "PC 画面ストリーミング", zh: "PC 串流" } },
  { repo: "J-D-K/JKSV", purpose: { ko: "세이브 백업", en: "Save backup", ja: "セーブのバックアップ", zh: "存档备份" } },
  { repo: "BernardoGiordano/Checkpoint", purpose: { ko: "세이브 백업", en: "Save backup", ja: "セーブのバックアップ", zh: "存档备份" } },
  { repo: "joel16/NX-Shell", purpose: { ko: "파일 관리자", en: "File manager", ja: "ファイルマネージャー", zh: "文件管理器" } },
  { repo: "mtheall/ftpd", purpose: { ko: "FTP 서버", en: "FTP server", ja: "FTP サーバー", zh: "FTP 服务器" } },
  { repo: "DarkMatterCore/nxdumptool", purpose: { ko: "덤프 도구", en: "Dump tool", ja: "ダンプツール", zh: "转储工具" } },
  { repo: "ITotalJustice/sphaira", purpose: { ko: "홈브류 메뉴", en: "Homebrew menu", ja: "自作アプリメニュー", zh: "自制程序菜单" } },
  { repo: "HamletDuFromage/aio-switch-updater", purpose: { ko: "업데이트 도구", en: "Updater", ja: "アップデーター", zh: "更新工具" } },
  { repo: "exelix11/SwitchThemeInjector", purpose: { ko: "테마 설치", en: "Theme installer", ja: "テーマのインストール", zh: "主题安装" } },
  { repo: "nadrino/SimpleModManager", purpose: { ko: "모드 관리", en: "Mod manager", ja: "MOD 管理", zh: "模组管理" } },
  { repo: "WerWolv/EdiZon", purpose: { ko: "치트 관리", en: "Cheat manager", ja: "チート管理", zh: "金手指管理" } },
  { repo: "averne/Fizeau", purpose: { ko: "화면 색 보정", en: "Screen colour", ja: "画面の色補正", zh: "屏幕色彩调整" } },
  { repo: "meganukebmp/Switch_90DNS_tester", purpose: { ko: "90DNS 차단 확인", en: "90DNS check", ja: "90DNS の確認", zh: "90DNS 检查" } },
];
