// The prod.keys row's words about key generations, in the four languages of the admin page's top
// area (merged into top-i18n.js TOP_WORDS, so the parity test covers them). "{x}" is filled by the panel.

export const KEYS_WORDS = {
  ko: {
    "keys.gen": "서버 prod.keys 의 버전은 {fw} 입니다(키 {gen}세대). 펌웨어 버전 무시 설치는 이 버전까지의 게임을 낮은 펌웨어 기기에 맞춰 보냅니다.",
    "keys.noGen": "키 세대를 알 수 없습니다. header_key 와 key_area_key 또는 master_key 항목이 있는지 확인합니다.",
    "keys.above": "라이브러리 게임 {n}개는 펌웨어 버전 무시 설치에 더 새 키가 필요합니다. {version} 이상 버전의 prod.keys 로 교체해 주세요.",
    "keys.aboveNone": "라이브러리 게임은 모두 이 키 세대 안에 있습니다.",
    "keys.pending": "게임 파일 {n}개는 아직 키 세대를 읽지 않았습니다. 백그라운드에서 읽고 있습니다.",
  },
  en: {
    "keys.gen": "The server's prod.keys is version {fw} (key generation {gen}). Install ignoring firmware version prepares games up to this version for consoles on an older firmware.",
    "keys.noGen": "The key generation cannot be told. Check that the file has header_key and key_area_key or master_key entries.",
    "keys.above": "{n} library games need newer keys for Install ignoring firmware version. Replace prod.keys with one from firmware {version} or later.",
    "keys.aboveNone": "Every library game is within this key generation.",
    "keys.pending": "{n} game files have not had their key generation read yet. They are being read in the background.",
  },
  ja: {
    "keys.gen": "サーバーの prod.keys のバージョンは {fw} です(キー第{gen}世代)。ファームウェアのバージョンを無視してインストールでは、このバージョンまでのゲームを古いファームウェアの本体向けに用意します。",
    "keys.noGen": "キー世代がわかりません。header_key と key_area_key または master_key の項目があるか確認します。",
    "keys.above": "ライブラリのゲーム {n} 本は、ファームウェアのバージョンを無視してインストールするにはもっと新しいキーが必要です。{version} 以降の prod.keys に置き換えてください。",
    "keys.aboveNone": "ライブラリのゲームはすべてこのキー世代に収まっています。",
    "keys.pending": "ゲームファイル {n} 個はまだキー世代を読んでいません。バックグラウンドで読んでいます。",
  },
  zh: {
    "keys.gen": "服务器的 prod.keys 版本为 {fw}(密钥第 {gen} 代)。忽略固件版本安装会把这个版本以内的游戏为旧固件主机准备好。",
    "keys.noGen": "无法判断密钥代数。请确认文件中有 header_key 以及 key_area_key 或 master_key 条目。",
    "keys.above": "库中有 {n} 个游戏需要更新的密钥才能忽略固件版本安装。请换成 {version} 或更高版本的 prod.keys。",
    "keys.aboveNone": "库中的游戏都在这一密钥代数以内。",
    "keys.pending": "还有 {n} 个游戏文件尚未读取密钥代数,正在后台读取。",
  },
};
