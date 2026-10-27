/**
 * The words of a chat notice card in the four admin languages. Every language has every key; a
 * template holds {name} {menu} {label} {count} where the card fills them in.
 */
export const NOTICE_TEXT = Object.freeze({
  ko: {
    someone: "누군가",
    titleRequest: "승인 요청", titleApplied: "변경 반영", titleUpload: "새 파일 반영",
    did: "{name}님이 {menu}에서 {label} 작업을 했습니다",
    asked: "{name}님이 {menu}에서 {label} 작업을 요청했습니다",
    times: "{name}님이 {menu}에서 {label} 작업을 {count}건 했습니다",
    menu_games: "게임", menu_library: "라이브러리", menu_retro: "레트로", menu_admin: "관리", menu_plugins: "플러그인", menu_jobs: "작업",
    label_upload_apply: "파일 올리기",
    label_game_art_set: "이미지 변경", label_game_art_crop: "이미지 자르기", label_retro_cover_set: "이미지 변경",
    label_retro_art_match: "이미지 맞추기", label_retro_art_sync: "이미지 가져오기",
    label_retro_ko_name_decide: "한국어 이름 정하기", label_settings_set: "설정 변경", label_integration_set: "연동 변경",
    label_account_set: "계정 변경", label_device_set: "기기 변경", label_trash_restore: "휴지통 복원", label_trash_undo: "되돌리기",
    label_retro_cores_update: "코어 갱신", label_retro_cores_fetch_missing: "코어 받기",
  },
  en: {
    someone: "Someone",
    titleRequest: "Approval needed", titleApplied: "Change applied", titleUpload: "New file added",
    did: "{name} did {label} in {menu}",
    asked: "{name} asked for {label} in {menu}",
    times: "{name} did {label} {count} times in {menu}",
    menu_games: "Games", menu_library: "Library", menu_retro: "Retro", menu_admin: "Admin", menu_plugins: "Plugins", menu_jobs: "Jobs",
    label_upload_apply: "file upload",
    label_game_art_set: "image change", label_game_art_crop: "image crop", label_retro_cover_set: "image change",
    label_retro_art_match: "image matching", label_retro_art_sync: "image fetch",
    label_retro_ko_name_decide: "Korean name choice", label_settings_set: "settings change", label_integration_set: "integration change",
    label_account_set: "account change", label_device_set: "device change", label_trash_restore: "trash restore", label_trash_undo: "undo",
    label_retro_cores_update: "core update", label_retro_cores_fetch_missing: "core download",
  },
  ja: {
    someone: "誰か",
    titleRequest: "承認のお願い", titleApplied: "変更を反映", titleUpload: "新しいファイルを反映",
    did: "{name}さんが{menu}で{label}をしました",
    asked: "{name}さんが{menu}で{label}を依頼しました",
    times: "{name}さんが{menu}で{label}を{count}件行いました",
    menu_games: "ゲーム", menu_library: "ライブラリ", menu_retro: "レトロ", menu_admin: "管理", menu_plugins: "プラグイン", menu_jobs: "ジョブ",
    label_upload_apply: "ファイルのアップロード",
    label_game_art_set: "画像の変更", label_game_art_crop: "画像の切り抜き", label_retro_cover_set: "画像の変更",
    label_retro_art_match: "画像の照合", label_retro_art_sync: "画像の取得",
    label_retro_ko_name_decide: "韓国語名の決定", label_settings_set: "設定の変更", label_integration_set: "連携の変更",
    label_account_set: "アカウントの変更", label_device_set: "端末の変更", label_trash_restore: "ゴミ箱から復元", label_trash_undo: "元に戻す",
    label_retro_cores_update: "コアの更新", label_retro_cores_fetch_missing: "コアの取得",
  },
  zh: {
    someone: "有人",
    titleRequest: "需要批准", titleApplied: "更改已生效", titleUpload: "新文件已生效",
    did: "{name}在{menu}执行了{label}",
    asked: "{name}在{menu}请求了{label}",
    times: "{name}在{menu}执行了{count}次{label}",
    menu_games: "游戏", menu_library: "库", menu_retro: "复古", menu_admin: "管理", menu_plugins: "插件", menu_jobs: "任务",
    label_upload_apply: "上传文件",
    label_game_art_set: "更换图片", label_game_art_crop: "裁剪图片", label_retro_cover_set: "更换图片",
    label_retro_art_match: "匹配图片", label_retro_art_sync: "获取图片",
    label_retro_ko_name_decide: "确定韩文名称", label_settings_set: "更改设置", label_integration_set: "更改集成",
    label_account_set: "更改账户", label_device_set: "更改设备", label_trash_restore: "从回收站恢复", label_trash_undo: "撤销",
    label_retro_cores_update: "更新核心", label_retro_cores_fetch_missing: "下载核心",
  },
});

export const NOTICE_LANGS = Object.freeze(Object.keys(NOTICE_TEXT));
