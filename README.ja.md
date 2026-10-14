# CookingFoil

[English](README.md) | [한국어](README.ko.md) | **日本語** | [简体中文](README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

Switch の自作ソフト向けの、個人用でセルフホストのファイルサーバー兼ショップです。ファイルは自宅のマシンに置き、1 つの管理ページですべてを管理し、本体の自作クライアント (CookingFoil クライアント、CyberFoil、Tinfoil 互換クライアント) からインストールします。

Web サイト: <https://jshsakura.github.io/oc-cookingfoil/>

## 目次

- [概要](#概要)
- [機能](#機能)
- [クイックスタート](#クイックスタート)
- [フォルダー構成](#フォルダー構成)
- [設定](#設定)
- [管理ページ](#管理ページ)
- [クライアントの接続](#クライアントの接続)
- [リバースプロキシと HTTPS](#リバースプロキシと-https)
- [任意の直接ダウンロードアドレス](#任意の直接ダウンロードアドレス)
- [セキュリティモデル](#セキュリティモデル)
- [API](#api)
- [FAQ とトラブルシューティング](#faq-とトラブルシューティング)
- [開発](#開発)
- [法的事項](#法的事項)
- [ライセンスとクレジット](#ライセンスとクレジット)

## 概要

CookingFoil は自分のサーバー上の Docker で動きます。入れたファイルの名前とアイコンを調べ、その一覧を本体のクライアントに配信します。

- **すべてを 1 つの管理ページで。** 設定、アカウント、本体、アップロード、自作ソフト、パッチ、セーブ、名前はブラウザーで変更します。変更はすぐに反映され、再起動も手でのファイル編集も要りません。
- **何も同梱していません。** ゲーム、キー、ファームウェア、BIOS ファイル、RetroArch は含まれていません。それらのフォルダーは空の状態で始まり、正当に所有するファイルを入れるまで、関係する機能はオフのままです。
- **最初から非公開です。** 初回セットアップにはサーバーログに出るコードが必要です。本体は QR 承認か、その本体専用のログインで接続するので、アカウントのパスワードが本体に残ることはありません。

| プロジェクト | 動く場所 | 配布物 |
|---|---|---|
| CookingFoil サーバー (このリポジトリ) | Docker ホスト | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil クライアント | 本体の自作アプリメニュー | [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) |

Web ページ、初回セットアップ、サインイン、本体承認のページは英語、韓国語、日本語、簡体字中国語に対応しています。管理ページと運用ガイド (`/admin/guide`) は今のところ韓国語のみです。

## 機能

- **ショップの一覧とセクション。** Tinfoil 形式のインデックス (`/shop.tfl`, `/shop.json`) と、CyberFoil と CookingFoil クライアント向けのセクション分けされた一覧を提供します。おすすめの列は管理ページで並べられます。
- **名前とアイコン。** タイトル、説明、アートワークは [blawar/titledb](https://github.com/blawar/titledb) から取得し、titledb にないファイルはファイル自体から (自分の `prod.keys` を使って) 読み取ります。名前の言語の優先順位と地域は設定で変えられます。
- **アートワーク、価格、評価。** アイコン、バナー、スクリーンショットは公開ストアのアートワークサービスから取得し、ディスクにキャッシュします。ストア価格、人気順、Steam のレビュースコア、IGDB スコアも任意で使えます。どの取得元もオフにでき、自分のアートワークをアップロードすることもできます。
- **GitHub からの自作ソフト。** リポジトリを登録すると最新リリース (`.nro`、または中に `.nro` を含む zip) を追いかけます。手で置いたアプリも扱えます。アプリごとに HOME メニューのショートカットを用意できます。
- **セーブとパッチ。** セーブファイルとパッチ (SD カードのルートと同じ構成) をサーバーに置いておき、どれを入れるかをクライアントで選びます。
- **RetroArch 向けレトロゲーム。** システムごとの ROM、libretro-thumbnails のボックスアート、The Bezel Project のベゼル、LaunchBox Games Database のゲーム情報 (説明、パブリッシャー、開発元、発売日、人数、ジャンル、スクリーンショット) を扱い、足りない分は IGDB で補います。自分で用意した RetroArch ベースパックを本体に配ることができ、ゲームごとに HOME メニューのショートカットも作れます。
- **QR による本体ペアリング。** CookingFoil クライアントが QR コードを表示します。スマートフォンで読み取り、サインインして承認します。本体にパスワードは保存されません。
- **アカウントと Google サインイン。** 管理者とユーザーの役割を持つ ID とパスワードのアカウント、本体ごとのログイン、任意の Google サインインに対応します。新しい Google アカウントは承認待ちになります。
- **2 要素目のある管理ページ。** 管理ページは認証アプリ (TOTP) のコードか、別の管理者パスワードをもう一度求めます。自動化トークンを使えば、スクリプトから同じ API を使えます。
- **一時共有の受け箱。** サインインしたユーザーは、運営者が後で整理するためのファイル、メモ、リンクを残せます。
- **Telegram 通知。** 本体とアカウントの承認依頼 (承認と拒否のボタン付き)、ロックアウト、ブロックした攻撃の試み、一時共有へのアップロード、サーバーの起動を知らせます。
- **途切れないダウンロード。** 再起動のときは新しいリクエストに `503` と `Retry-After` で応答し、実行中のダウンロードが終わるのを先に待ちます。任意の直接ダウンロードアドレスはダウンロード専用で、サインインの代わりに短時間だけ有効なダウンロードトークンで開きます。

## クイックスタート

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

1. `http://<host>:9080/` を開きます。初回セットアップが表示されます。
2. ログに出たセットアップコードを入力します。コードは起動するたびに変わるので、ログを見られない人がサーバーを乗っ取ることはできません。
3. 管理者アカウントを作り、認証アプリを登録します。
4. 管理ページが開きます。ほかのことはすべてそこで行います。

クライアントには、ブラウザーで開いたのと同じアドレスを入れます。更新するときは `docker compose pull && docker compose up -d` を実行します。

compose ファイルの要点です ([完全なファイル](./docker-compose.yml) には各行にコメントがあります)。

```yaml
services:
  cookingfoil:
    image: ghcr.io/jshsakura/oc-cookingfoil:latest
    restart: unless-stopped
    stop_grace_period: 40s
    env_file:
      - path: .env
        required: false
    ports:
      - "9080:80"
    volumes:
      - ./games:/games
      - ./data:/data
      - ./keys:/keys:ro
      - ./retro:/retro
      - ./patches:/patches
      - ./saves:/saves
      - ./homebrew:/homebrew
```

## フォルダー構成

```
cookingfoil/
├── docker-compose.yml
├── .env              # optional; defaults for the first start
├── games/            # your packages (.nsp .nsz .xci .xcz)
├── data/             # cache, accounts and every setting saved on the admin page. Back this one up
├── keys/             # optional, read-only: your own prod.keys
├── retro/            # retro ROMs, art and the RetroArch base pack
├── patches/          # patches by base title id, and homebrew/<app>/
├── saves/            # save files by title id, and homebrew/<app>/
└── homebrew/         # .nro apps, app folders, or a release zip left in its own folder
```

ないフォルダーは Docker が作ります。すべてを別の場所に置くには `.env` に `COOK_ROOT=/path/to/cookingfoil` を設定します。1 つだけ移すには、そのフォルダーのパスを設定します。たとえば `COOK_GAMES_PATH=/path/to/games` です。ほかは `COOK_DATA_PATH`、`COOK_KEYS_PATH`、`COOK_RETRO_PATH`、`COOK_PATCHES_PATH`、`COOK_SAVES_PATH`、`COOK_HOMEBREW_PATH` です。

`retro/` の中身です。

```
retro/
├── roms/<system>/<game file>                          # a game, or a subfolder holding one
├── thumbnails/<system>/Named_Boxarts/<game name>.png  # box art (fetched, or your own)
├── bezels/<system>/<game name>.png                    # bezels (fetched, or your own)
├── screenshots/                                       # game screenshots (fetched)
├── retroarch/                                         # your RetroArch base pack (optional)
├── systems.json                                       # optional overrides of folder and libretro names
└── arcade-names.json                                  # optional arcade display names
```

システムごとに、短い ID の名前を付けたフォルダーを 1 つ使います: `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` `neocd`。アーケードのゲームは FinalBurn Neo のセット名 (たとえば `mslug.zip`) のまま使います。ボックスアートはファイル名に含まれる英語タイトルで照合するので、`My Title (English Title)` のような名前がいちばんうまくいきます。

RetroArch ベースパックは、本体が遊ぶ前に一度だけ必要になるものです。`retroarch.nro`、`retroarch.cfg`、RetroArch が使うフォルダー (`cores/`、`assets/`、`system/` など) を `retro/retroarch/` に置きます。ゲームのあるシステムで足りない BIOS ファイルは管理ページが教えてくれます。CookingFoil が BIOS を配布することはありません。

## 設定

ほとんどの設定は管理ページで変更し、すぐに反映されます。`.env` の値は初回起動時の既定値にすぎません。管理ページで設定を変えるとページの値が優先され、「compose の値に戻す (compose 값으로)」操作で `.env` の値に戻ります。すべての変数とその説明は [`.env.example`](./.env.example) にあります。

次の変数は管理ページができる前に必要か、意図的に管理ページから外してあるものです。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | ホスト側のポート |
| `COOK_ROOT` | `.` | 上のフォルダーを作るホスト側のフォルダー |
| `COOK_TRUST_PROXY` | _(空)_ | クライアントのアドレスを設定してよいプロキシのホップ。例: `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` にすると、アカウントのないサーバーでもブラウザーを `/setup` に送らず開いたままにします |
| `COOK_AUTH_USERS` | _(空)_ | `/setup` の代わりに用意するアカウント。`user:pass,user2:pass2` |
| `COOK_ADMIN_PASSWORD` | _(空)_ | 管理者パスワードと認証アプリの両方をなくしたときの入口 (12 文字以上) |
| `COOK_ADMIN_TOTP_SECRET` | _(空)_ | `/setup` を使わず、認証アプリのシークレットを自分で管理します |
| `COOK_DIRECT_EDGE_SECRET` | _(空)_ | 直接ダウンロード用プロキシとの共有シークレット。[後述](#任意の直接ダウンロードアドレス)を参照してください |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_AUTH_MAX_FAILURES` | `1200`, `5` | アドレスごとのレート制限と、ロックアウトまでのサインイン失敗回数 |

ふだんは管理ページ (設定 (설정) タブ) で変える設定です。どれも `.env` で既定値を入れておけます。

| 設定 | 変数 | 既定値 |
|---|---|---|
| QR による本体接続 | `COOK_DEVICE_PAIRING` | `false` |
| 本体の承認方法 | `COOK_DEVICE_AUTO_APPROVE` | `true` (サインインした本体は承認されます) |
| 公開アドレス | `COOK_PUBLIC_BASE_URL` | リクエストごとに導出 |
| Web アップロード | `COOK_UPLOADS_ENABLED` | `false` |
| 一時共有の受け箱 | `COOK_INBOX_ENABLED` | `true` |
| 名前の言語の優先順位 | `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` |
| titledb のダウンロード、地域、取得元 | `COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL` | オン、組み込みのセット、blawar/titledb |
| ファイルから読むアイコン | `COOK_EXTRACT_ICONS` | `missing` |
| ストア価格、人気、アートワーク | `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` | オン |
| レビュースコア、レトロゲーム情報 | `COOK_RATING_SYNC`, `COOK_RETRO_META` | オン |
| 1 回のダウンロードの接続数 | `COOK_DOWNLOAD_MAX_CONNECTIONS` | `4` |
| 直接ダウンロードアドレス、トークンの有効期間 | `COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL` | オフ、`21600` 秒 |
| 安全な再起動 | `COOK_RESTART_RETRY_AFTER`, `COOK_RESTART_GRACE` | `20` 秒、`25` 秒 |

外部サービスのキー (IGDB、SteamGridDB、Dropbox、GitHub、評価サーバー)、Google サインイン、Telegram 通知は管理ページで入力します。それぞれの取得先もそこに書いてあります。どれも任意で、ないときはそれを必要とする機能だけがオフになります。

## 管理ページ

`/admin` を開きます。サインインの後、認証アプリのコードか管理者パスワードをもう一度求めます (Google でサインインした管理者には求めません)。変更はすべて `data/` に保存され、すぐに反映されます。

| タブ | できること |
|---|---|
| 概要 (개요) | サーバーの状態、設定の警告、ゲーム名の取得元 |
| ユーザー (사용자) | アカウントと役割、承認待ちの Google アカウント |
| 本体 (기기) | 本体の承認と拒否、名前の変更と切断、本体 1 台用のログイン作成 |
| 設定 (설정) | サーバーの動作 (本体の承認、アップロード、公開アドレス、歓迎メッセージ、名前と地域、ストアのデータ、評価、ダウンロード、安全な再起動)、外部サービスのキー、Google サインイン、管理者パスワード、認証アプリ、自動化トークン |
| 通知 (알림) | Telegram 通知と、その対象のイベント |
| ログ (로그) | ロックされたアドレス、理由付きの拒否されたリクエスト、クライアントのエラー報告 |
| おすすめ (추천) | クライアントのホーム画面の上部に並ぶ列 |
| ライブラリ (라이브러리) | ファイルの検索と削除、パッチとセーブの編集、移動、削除、必須パッチの指定、ゲームの名前、説明、メモの設定 |
| アップロード (업로드) | ゲーム、レトロ ROM、パッチ、セーブ、自作ソフトをファイル単位かフォルダー単位で |
| 一時共有 (임시 공유) | サインインしたユーザーが残したファイル、メモ、リンク |
| 自作ソフト (홈브류) | GitHub リポジトリの追加、アプリのオンとオフ、削除、手で置いたアプリとリポジトリの関連付け |
| レトロ (레트로) | ボックスアートとベゼル、カバーのアップロード、表示名、バリエーション、ROM の削除 |

`/admin/guide` の運用ガイドは作業ごとの手順と、管理ページが使う API をまとめています。自動化トークンを持つスクリプトや AI アシスタントも同じ作業ができます。

## クライアントの接続

**CookingFoil クライアント。** [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) をダウンロードし、SD カードの `switch/` フォルダーに入れて自作アプリのメニューから開きます。サーバーのアドレスを入力します。QR による本体接続 (設定 (설정) タブのサーバーの動作) がオンなら本体に QR コードが出るので、スマートフォンで読み取り、サインインして承認します。接続後、クライアントはサーバーから自分自身を更新し、HOME メニューのショートカットも作れます。

**CyberFoil または Tinfoil 互換クライアント。** サーバーをショップとして追加します。

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

自宅のネットワークでは、サーバーのローカルアドレスに `http` とポート `9080` を使うこともできます。ユーザー名とパスワードには、本体 (기기) タブで作る本体ごとのログインを使うほうが安全です。一覧を読むことしかできず、最初に使った本体に固定され、いつでも取り消せます。自分のアカウントでも使えます。Tinfoil では *File Browser* を開いて `+` を押し、同じ項目を入力します。

標準の Tinfoil と CyberFoil は QR でペアリングできません。これらは常にアカウントか本体ごとのログインでサインインし、ペアリング済みの本体と並行して使えます。

## リバースプロキシと HTTPS

CookingFoil はプレーンな HTTP で動きます。自宅の外から使うには、HTTPS を終端するリバースプロキシやトンネル (nginx、Caddy、Traefik、Cloudflare Tunnel など) の後ろに置きます。

そのまま使える Caddy (HTTPS を一つのスタックで)、nginx、Cloudflare Tunnel の設定ファイルは [`examples/`](examples/) にあります。

- `COOK_TRUST_PROXY` には、クライアントのアドレスを設定してよいホップだけを指定します。同じホストかプライベートネットワーク上のプロキシなら `loopback, uniquelocal` です。`true` はすべてのホップを信頼するので、プロキシを経由しないとサーバーに届かない構成でのみ安全です。この設定がないと、すべてのクライアントがプロキシの 1 つのアドレスに見えるため、見知らぬ 1 人のサインイン失敗で全員がロックされることがあります。この状態を検出すると管理ページが警告します。`X-Forwarded-Host` と `X-Forwarded-Proto` もこれらのホップから届いたものだけを信頼し、それ以外からの場合は接続自体の `Host` (設定していれば `COOK_PUBLIC_BASE_URL`) を使います。
- プロキシには `X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host` を転送させます。ダウンロードとアートワークの URL は絶対 URL で、これらのヘッダーから組み立てます。プロキシが `Host` を書き換える場合は、管理ページで公開アドレスを設定します (または `COOK_PUBLIC_BASE_URL=https://shop.example.org`)。
- 大きなレスポンスと長いリクエストを許可します。本体は多数の Range リクエストでダウンロードし、1 つのファイルが数十 GB になることもあります。
- CookingFoil の前に置いた開発サーバー (Vite など) は、知らない `Host` ヘッダーを `403` で拒否することがあります。プロキシを疑う前に `curl -H "Host: shop.example.org" http://127.0.0.1:9080/` でオリジンを直接確かめてください。

## 任意の直接ダウンロードアドレス

構成によっては、ショップが経由するトンネルや CDN が非常に大きなファイルに対して遅かったり制限があったりします。直接ダウンロードアドレスを使うと、それを求めるクライアントはダウンロードだけを扱う 2 つ目の HTTPS アドレスから受け取り、一覧とサインインはメインのアドレスに残ります。

仕組みです。

1. コンテナと同じホスト上のリバースプロキシが、たとえば `https://dl.example.org` を提供します。このプロキシは `Authorization: Bearer …` を持つ `GET` と `HEAD` のリクエストだけを転送し、`X-Forwarded-For` を自分で設定し、`Host` を直接アドレス (ポートがあればポート付き) にし、`X-CookingFoil-Edge: <secret>` を付けます。メインのトンネルを通ってきたリクエストは転送してはいけません。
2. 同じシークレットを `.env` の `COOK_DIRECT_EDGE_SECRET` に入れます。これは管理ページの設定にはなりません。設定がないと、直接アドレスは何も返しません。
3. アドレスは管理ページ (設定 (설정) タブのダウンロード) か `COOK_PUBLIC_DIRECT_BASE_URL` に入れます。`https://` である必要があります。
4. HTTPS で `X-CookingFoil-Features: direct-token` を送るサインイン済みのクライアントは `X-CookingFoil-Download-Token` ヘッダーを受け取り、一覧のダウンロード URL が直接アドレスを指すようになります。クライアントはそこにトークンを Bearer トークンとして送ります。

トークンはサーバーが署名し (`data/security/` にあるランダムな鍵による HMAC-SHA256)、`COOK_DOWNLOAD_LINK_TTL` 秒 (既定は 6 時間) 有効で、発行対象のアカウントや本体がサインインできなくなった時点で使えなくなります。拒否のレスポンスには `X-CookingFoil-Token: invalid | expired | revoked | blocked` が付き、無効なトークンを送りすぎたアドレスはしばらく締め出されます。この機能を宣言しないクライアント (Tinfoil、CyberFoil、ブラウザー) とプレーンな HTTP のリクエストには、これまでとまったく同じ一覧が返ります。Cloudflare 経由で届き、`CF-IPCountry` が `src/security/download-links.js` に固定された国以外のリクエストは、通常の URL のままです。

DNS 証明書と DDNS まで含む Caddy の完全な設定は [`examples/direct-download/`](examples/direct-download/) にあります。

最小限の nginx の例です (証明書、ポート、シークレットは環境に合わせてください)。

```nginx
server {
  listen 443 ssl;
  server_name dl.example.org;
  # ssl_certificate ...; ssl_certificate_key ...;

  location / {
    limit_except GET HEAD { deny all; }
    if ($http_authorization !~ "^Bearer ") { return 401; }
    proxy_set_header Host dl.example.org;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header CF-Connecting-IP "";
    proxy_set_header X-CookingFoil-Edge "change-me-to-a-long-random-string";
    proxy_buffering off;
    proxy_pass http://127.0.0.1:9080;
  }
}
```

## セキュリティモデル

- **セットアップはログのコードで確保します。** 管理者がいない間、`/setup` には起動時に表示されるコードが必要で、このコードは毎回変わります。
- **パスワード**は scrypt のハッシュで保存します。失敗が続くとそのアドレスをロックし (`COOK_AUTH_MAX_FAILURES`、`COOK_LOCKOUT_TTL_HOURS`)、すべてのアドレスにレート制限があります。
- **管理ページ**にはサインインに加えて 2 要素目が必要です。TOTP のコードか、別の管理者パスワードです。コードを間違え続けると、アカウントとアドレスがロックされます。
- **本体**は、デバイスキーと承認後に発行されるアクセスキーで接続するか、一覧を読むことしかできず 1 台に固定される本体ごとのログインで接続します。承認は手動、サインインした本体の自動承認、すべての自動承認から選べます。
- **自動化トークン**は作成した管理者として動き、`/admin/api/` の下でのみ使えます。アカウント、サインイン方法、トークンは変更できません。
- 直接アドレス用の**ダウンロードトークン**は短時間だけ有効で、署名され、アカウントと本体に結び付き、エッジシークレットを持つローカルのプロキシからしか受け付けません。
- 管理ページで保存した**シークレット**は二度と表示しません。キーとトークンは `data/` にあるので、このフォルダーを保護してバックアップしてください。
- レスポンスには防御用のヘッダー (`nosniff`、`DENY` のフレーミング、リファラーなし) が付き、既知の攻撃パスはサインインの前に拒否します。

脆弱性の報告は [SECURITY.md](./SECURITY.md) を参照してください。

## API

ペアリングと `/healthz` を除き、すべてのエンドポイントはショップと同じサインイン (アカウント、本体ごとのログイン、ペアリング済みの本体) の後ろにあります。

| エンドポイント | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 形式のインデックス |
| `GET /api/shop/sections` | CyberFoil と CookingFoil クライアント向けのセクション分けされた一覧 |
| `GET /api/shop/info` | サーバーのバージョン、ダウンロードのヒント、クライアントが前提にしてよい `features` |
| `GET /api/title/:id?lang=`, `/api/title/:id/extras` | 1 件の詳細と、その追加ファイル |
| `GET /api/shop/icon/:id`, `/api/shop/banner/:id`, `/api/shop/screenshot/:id/:n` | アートワーク |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/file?path=`, `/bundle`, `/archive`, `/forwarder` | 自作アプリ (`.nro` 1 つか、`switch/<app>/` フォルダー全体) と、その HOME メニューのショートカット。管理ページでオフにしたアプリは含まれません |
| `GET /api/patches?lang=`, `/api/patches/:id/download` | パッチ |
| `GET /api/saves?lang=`, `/api/saves/:id/download` | セーブファイル |
| `GET /api/retro/systems`, `/api/retro/games`, `/api/retro/games/:id/rom`, `/bundle`, `/boxart`, `/bezel.png`, `/forwarder.nsp` | レトロフォルダーに ROM があるときの、レトロゲームとそのアート |
| `GET /api/retro/base-pack/manifest`, `/api/retro/base-pack/bundle` | 自分で用意した RetroArch ベースパック |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | `data/client/` に置いた CookingFoil クライアントのビルドと、その HOME メニューのショートカット |
| `POST /api/pair/request`, `GET /api/pair/status` | QR による本体ペアリング (QR による本体接続がオンのときのみ)。本体はリクエスト時にランダムな `pairSecret` (16 進数 64 文字) を送り、状態を問い合わせるときに同じ値を `X-Pair-Secret` で送ります。アクセスキーはその値を送った側にだけ渡します |
| `GET /healthz` | ヘルスチェック。イメージの `HEALTHCHECK` が使います |

クライアントは任意のフィールドを使う前に、`/api/shop/info` の `features` を読んでください。管理 API (`/admin/api/*`) は `/admin/guide` の運用ガイドに説明があります。

## FAQ とトラブルシューティング

**本体が接続できません。** 概要 (개요) タブの警告と、ログ (로그) タブの拒否されたリクエストを見てください。拒否ごとに理由が書いてあります。

**ログ (로그) タブには何も出ないのに、本体はサーバーが応答しないと言います。** リクエストがサーバーまで届いていません。多くの場合、ルーターの DNS が応答していません。本体の DNS を手動で `1.1.1.1` (セカンダリ `8.8.8.8`) などの公開リゾルバーにするか、ルーターが配る DNS を変えてください。

**プロキシの後ろで全クライアントが一度にロックされます。** `COOK_TRUST_PROXY` が設定されていないため、すべてのクライアントがプロキシのアドレスを共有しています。[リバースプロキシと HTTPS](#リバースプロキシと-https) を参照してください。

**自分のアドレスがロックされました。** ログ (로그) タブで解除します。管理ページに入れない場合は、`COOK_RESET_LOCKOUTS=true` で一度起動してから、その設定を外してください。

**認証アプリをなくしました。** 管理者パスワードを設定していれば、それでサインインします。両方なくした場合は、`.env` に `COOK_ADMIN_PASSWORD` (12 文字以上) を入れて再起動し、そのパスワードでサインインします。

**名前がファイル名のまま表示されます。** titledb をまだダウンロード中か、そのタイトルが titledb にありません。自分の `prod.keys` を `keys/` に置けばファイルから名前とアイコンを読めます。概要 (개요) タブの名前の状態パネルも確認してください。

**CyberFoil にインストールできない行が出ます。** `COOK_EMIT_TITLEDB` はオフのままにしてください。これは標準の Tinfoil 専用です。

**レトロゲームのボックスアートがありません。** レトロ (레트로) タブで「足りないものをすべて取得 (빠진 것 모두 받기)」を使うか、ゲームを手で照合します。GitHub トークン (設定 (설정) タブ) を入れると、GitHub の 1 時間 60 回の制限が緩和されます。

## 開発

Node.js 20 以上が必要です (イメージと CI は Node 22 を使います)。

```bash
npm install
cp .env.example .env
npm run dev             # http://localhost:3001
npm run lint
npm run test:unit
npm run test:web        # after: npx playwright install chromium
```

```
src/
├── index.js        # server entry
├── routes/         # HTTP routes; admin/ holds each admin tab's API and panel
├── security/       # accounts, sessions, devices, lockouts, tokens, settings saved on the admin page
├── meta/           # names, icons, patches, saves, homebrew tracking
├── retro/          # retro folder, names, art, details and shortcuts
├── realtime/       # WebSocket updates for the web page (/ws/library)
└── views/          # the web page and the operator guide
forwarder/          # the HOME menu shortcut loader (nx-hbloader with a patch)
site/               # the GitHub Pages site
test/unit, test/web # node --test and Playwright
```

作業の流れ、コミットの書き方、4 言語のルールは [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 法的事項

CookingFoil は独立したオープンソースプロジェクトです。任天堂やその他のプラットフォーム保有者とは関係がなく、承認や後援も受けていません。ここで使っている名称は識別のためだけのものです。

ゲーム、キー、ファームウェア、BIOS ファイル、RetroArch、その他の著作物は一切含まれていません。ファイルは自分で用意し、それを使う権利があることに責任を持ってください。たとえば、所有するゲームのバックアップや、自分の本体から吸い出したキーです。権利のない人とコンテンツを共有するために CookingFoil を使わないでください。

## ライセンスとクレジット

MIT です。[LICENSE](./LICENSE) を参照してください。CookingFoil は Vinicios Clarindo による [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat) (MIT) のフォークとして始まりました。

次のものを利用しています。

- タイトル名、説明、アートワークのアドレス: [blawar/titledb](https://github.com/blawar/titledb)。実行時に取得します。
- サーバーが話すショップ形式: [CyberFoil](https://github.com/luketanti/CyberFoil) と Tinfoil。
- イメージに同梱: [nstool](https://github.com/jakcron/nstool) (MIT) と [nsz](https://github.com/nicoboss/nsz) (MIT)。
- HOME メニューのショートカット: [hacBrewPack](https://github.com/The-4n/hacBrewPack) (GPL-2.0) と [nx-hbloader](https://github.com/switchbrew/nx-hbloader) (ISC)。
- [libretro-thumbnails](https://github.com/libretro-thumbnails) のボックスアートと [The Bezel Project](https://github.com/thebezelproject) のベゼル。実行時に取得します。
- ゲーム情報とスコア: [LaunchBox Games Database](https://gamesdb.launchbox-app.com/)、[IGDB](https://www.igdb.com/)、Steam。実行時に取得します。
- アーケードの名前: [FinalBurn Neo](https://github.com/finalburnneo/FBNeo) のセット一覧。
- [Lucide](https://lucide.dev) のアイコン (ISC)、Baloo 2 と IBM Plex Sans KR のフォント (SIL OFL 1.1)。

同梱しているすべてのコンポーネントとそのライセンスは [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) にあります。
