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
- [セキュリティ](#セキュリティ)
- [API](#api)
- [FAQ とトラブルシューティング](#faq-とトラブルシューティング)
- [開発](#開発)
- [法的事項](#法的事項)
- [ライセンスとクレジット](#ライセンスとクレジット)

## 概要

CookingFoil は自分のサーバー上の Docker で動きます。入れたファイルの名前とアイコンを調べ、その一覧を本体のクライアントに配信します。

- **すべてを 1 つの管理ページで。** 設定、アカウント、本体、アップロード、自作ソフト、パッチ、セーブ、名前はブラウザーで変更します。変更はすぐに反映され、再起動も手でのファイル編集も要りません。
- **何も同梱していません。** ゲーム、キー、ファームウェア、BIOS ファイル、RetroArch は含まれていません。それらのフォルダーは空の状態で始まり、正当に所有するファイルを入れるまで、関係する機能はオフのままです。
- **最初から非公開です。** 初回セットアップにはサーバーログに出るコードが必要です。本体は QR 承認か、サーバーの Web 画面からダウンロードしたクライアントでその本体だけのアクセスキーを受け取って接続するので、アカウントのパスワードが本体に残ることはありません。ID とパスワードでサインインする本体は、自分でオンにするまで入れません。

| プロジェクト | 動く場所 | 配布物 |
|---|---|---|
| CookingFoil サーバー (このリポジトリ) | Docker ホスト | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil クライアント | 本体の自作アプリメニュー | 各サーバーが自分で配ります。Web 画面のクライアントのダウンロードカード |

CookingFoil クライアントは GitHub では公開していません。サーバーの `data/client/` にクライアントのビルドがあれば (そのフォルダーに置くか、管理ページのアップロード (업로드) タブで「クライアント」としてアップロードします)、そのサーバーにサインインしたユーザーが Web 画面からダウンロードします。

Web ページ、初回セットアップ、サインイン、本体承認のページは英語、韓国語、日本語、簡体字中国語に対応し、ライトとダークのテーマを選べます。管理ページと運用ガイド (`/admin/guide`) は今のところ韓国語のみです。

## 機能

- **ショップの一覧とセクション。** Tinfoil 形式のインデックス (`/shop.tfl`, `/shop.json`) と、CyberFoil と CookingFoil クライアント向けのセクション分けされた一覧を提供します。おすすめの列は管理ページで並べられます。
- **名前とアイコン。** タイトル、説明、アートワークは [blawar/titledb](https://github.com/blawar/titledb) から取得し、titledb にないファイルはファイル自体から (自分の `prod.keys` を使って) 読み取ります。名前の言語の優先順位と地域は設定で変えられます。
- **アートワーク、価格、評価。** アイコン、バナー、スクリーンショットは公開ストアのアートワークサービスから取得し、ディスクにキャッシュします。ストア価格、人気順、Steam のレビュースコア、IGDB スコアも任意で使えます。どの取得元もオフにでき、自分のアートワークをアップロードすることもできます。
- **GitHub からの自作ソフト。** リポジトリを登録すると最新リリース (`.nro`、または中に `.nro` を含む zip) を追いかけます。手で置いたアプリも扱えます。アプリはツールか移植版に分けられ、オフにでき、HOME メニューのショートカットも用意できます。
- **セーブとパッチ。** セーブファイルとパッチ (SD カードのルートと同じ構成) をサーバーに置いておき、どれを入れるかをクライアントで選びます。パッチは必須に指定でき、対応するゲームの更新バージョンを記録できます。
- **RetroArch 向けレトロゲーム。** システムごとの ROM、libretro-thumbnails のボックスアート、The Bezel Project のベゼル、LaunchBox Games Database のゲーム情報 (説明、パブリッシャー、開発元、発売日、人数、ジャンル、スクリーンショット) を扱い、足りない分は IGDB で補います。1 つのゲームの複数の版 (アーケードの親セットとクローンセット、複数の言語や地域の版) は 1 枚のカードにまとまり、ほかの版はもう 1 回押すと出ます。自分で用意した RetroArch ベースパックを本体に配ることができ、ゲームごとに HOME メニューのショートカットも作れます。
- **本体ごとに自分のキーで接続。** CookingFoil クライアントが表示する QR をスマートフォンで承認するか、Web 画面からダウンロードしたクライアントがそのまま接続します。どちらでも本体は自分専用のアクセスキーを受け取り、パスワードは保存されません。
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
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_RATE_LIMIT_BURST` | `1200`, `300` | 1 つのアドレスが 1 分間に送れるリクエスト数と、一度に送れる数 |
| `COOK_AUTH_MAX_FAILURES`, `COOK_LOCKOUT_TTL_HOURS` | `5`, `0` | アドレスをロックするまでのサインイン失敗回数と、ロックの長さ (`0` なら管理者が解除するまで) |
| `COOK_ADMIN_SESSION_HOURS` | `8` | 管理ページのサインインが続く時間 |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(空)_ | プライベート、ループバック、CGNAT のアドレスに解決されてもサーバーが取得してよいホスト名です。たとえば tailnet 内の評価サーバーです。管理ページで設定したそれ以外のアドレスが内部ネットワークを指す場合は拒否します |

ふだんは管理ページ (設定 (설정) タブ) で変える設定です。どれも `.env` で既定値を入れておけます。

| 設定 | 変数 | 既定値 |
|---|---|---|
| QR による本体接続 (Web 画面のクライアントのダウンロードにも必要です) | `COOK_DEVICE_PAIRING` | `true` |
| パスワードで接続する本体 (CyberFoil、Tinfoil、古い CookingFoil のビルド) | `COOK_CONSOLE_PASSWORDS` | `false`。アクセスキーを持つ本体だけが入れます。`true` なら ID とパスワードで接続する本体も受け付けます |
| 本体の承認方法 | `COOK_DEVICE_AUTO_APPROVE` | `true`: サインインした本体はすぐ承認します。`false`: 管理者が 1 台ずつ承認します。`all`: 求めてきた本体をすべて承認します |
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

入り口は 3 つあります。最初の 2 つは本体にその本体だけのアクセスキーを渡す方法で、最初からオンです。3 つ目は ID とパスワードでサインインする方法で、オンにするまではオフです。

**1. CookingFoil クライアントを QR で接続。** 自作アプリのメニューからクライアントを開き、サーバーのアドレスを入力すると、QR コードと 8 文字の本体コードが出ます。スマートフォンで QR を読み取るか `/pair` で本体コードを入力し、サインインして承認します。本体は自分専用のアクセスキーを受け取ります。

**2. CookingFoil クライアントを Web 画面から取得。** サーバーの Web 画面にサインインし、クライアントのダウンロードカードを使います。`switch/cookingfoil/cookingfoil.nro` と、このサーバーのアドレスと 1 回だけ使える登録トークンを入れた `config.json` の入った zip を受け取ります。`switch/` フォルダーを SD カードにコピーしてクライアントを開きます。最初の起動でクライアントがトークンを自分のアクセスキーに替え (`POST /api/pair/enroll`)、あなたのアカウントの下で承認されるので、読み取る必要はありません。トークンは 1 回だけ、ダウンロードから 24 時間以内にしか使えません。まだ使っていないダウンロードは、同じ画面か管理ページの本体 (기기) タブで取り下げられます。使うまでは zip を鍵と同じように扱ってください。

どちらの方法でも、クライアントはアクセスキーを 12 時間のセッショントークンに替え (`GET /api/session`)、以後はそのトークンだけを送ります。接続後はサーバーから自分自身を更新し、HOME メニューのショートカットも作れます。新しいデバイスキーに移る本体は、`POST /api/pair/rebind` で承認を引き継ぎます。

**3. CyberFoil または Tinfoil 互換クライアント。** これらは ID とパスワードでサインインし、QR ではペアリングできません。設定 (설정) タブで「パスワードで接続する本体」をオンにするか `COOK_CONSOLE_PASSWORDS=true` を設定してから、サーバーをショップとして追加します。

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

自宅のネットワークでは、サーバーのローカルアドレスに `http` とポート `9080` を使うこともできます (先に [セキュリティ](#セキュリティ) の平文 HTTP の説明を読んでください)。ユーザー名とパスワードには、本体 (기기) タブ (またはサインインしたユーザーなら誰でも `/pair`) で作る本体ごとのログインを使うほうが安全です。一覧を読むことしかできず、最初に使った本体に固定され、いつでも取り消せます。自分のアカウントでも使えます。Tinfoil では *File Browser* を開いて `+` を押し、同じ項目を入力します。

パスワードで接続する本体をオンにしてもオフにしても、Web 画面と管理ページには影響しません。そこではこれまでどおりアカウントでサインインします。

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
4. HTTPS で `X-CookingFoil-Features: direct-token` を送るサインイン済みのクライアントは `X-CookingFoil-Download-Token` ヘッダーを受け取り、一覧のダウンロード URL が直接アドレスを指すようになります。一緒に届く `X-CookingFoil-Download-Origin` は直接アドレスの origin で、クライアントはそこにだけトークンを Bearer トークンとして送ります。

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

## セキュリティ

CookingFoil は、自分のプロキシの後ろでインターネットに置かれることを前提に作っています。そのためロックされた状態で始まり、オンにしたものだけを開きます。この節では、何を設定するか、入り口ごとに何を信頼するか、アクセスをどう取り消すかを説明します。

### おすすめの設定

1. **パスワードで接続する本体はオフのままにします。** Tinfoil、CyberFoil、古い CookingFoil のビルドを使うときだけオンにします。CookingFoil クライアントは QR か Web 画面のクライアントのダウンロードで接続し、本体ごとに個別に取り消せる自分のキーを持たせます。
2. **管理ページの 2 要素認証を維持します。** セットアップのときに認証アプリを登録します。別の管理者パスワード (`COOK_ADMIN_PASSWORD`、12 文字以上) で代えることもできますが、どのショップアカウントのパスワードとも違うものにします。
3. **外からは HTTPS だけで入ります。** HTTPS を終端するリバースプロキシかトンネルを通してサーバーに届くようにし、平文 HTTP のポートはインターネットに公開しません。
4. **`COOK_TRUST_PROXY` にはプロキシの経路だけを入れ**、それより広くしません。[リバースプロキシと HTTPS](#リバースプロキシと-https) を参照してください。
5. **承認方法は理解して選びます。**「サインインした本体はすぐ承認」(既定) と「管理者が 1 台ずつ承認」が安全な選択です。「すべて承認」は自分の本体しか届かないサーバーでだけ使います。
6. **`data/` を守り、バックアップします。** アカウント、デバイスキー、署名キーがすべてここにあります。

### 入り口ごとに信頼するもの

| 誰か | 何で証明するか | できること |
|---|---|---|
| Web 画面のユーザー | アカウントの ID とパスワード、または Google サインイン (新しい Google アカウントは承認待ちになります) | 閲覧、自分の本体の承認、本体ごとのログインの作成、クライアントのダウンロード、一時共有、Web アップロードがオンならアップロード |
| 管理者 | 管理者ロールのアカウントと、認証アプリのコードまたは管理者パスワード | 管理ページのすべての操作。管理者セッションは `COOK_ADMIN_SESSION_HOURS` の間続きます |
| ペアリング済みの本体 | デバイスキーとアクセスキー、その後は同じデバイスキーに結び付いた 12 時間のセッショントークン | 一覧の読み取りとダウンロード |
| パスワードで接続する本体 | アカウント、または 1 台に固定された本体ごとのログイン。パスワードで接続する本体がオンのときだけ | 一覧の読み取りとダウンロード。本体ごとのログインは、本体を承認したりログインを作ったりする画面には届きません |
| 自動化トークン | `Authorization: Bearer cft_…` | `/admin/api/` の下の管理 API を、作成した管理者として使います。トークンの作成や取り消し、管理者のサインイン方法、機器の承認、機器ごとの接続情報、通知、サインインとアドレスに関する設定の変更はできません |
| 直接ダウンロードアドレス | エッジシークレットを持つローカルのプロキシを通った、短時間だけ有効なダウンロードトークン | `GET` と `HEAD` のダウンロードだけ |

全員が見るもの (アートワーク、説明、ゲームフォルダーのファイル) の変更とアップロードの一覧は、管理者アカウントだけが扱えます。一般ユーザーのアカウント、本体ごとのログイン、ペアリング済みの本体は読むだけです。

### 本体の承認方法

サインインしたユーザーによる QR の承認と、Web 画面からダウンロードしたクライアントは、承認方法にかかわらず常にそのユーザーのアカウントの下で本体を承認します。つまりアカウントを持つ人は誰でも本体を追加できるので、アカウントは信頼できる人にだけ渡してください。それ以外の本体は、設定 (설정) タブの承認方法で決まります。

- **管理者が 1 台ずつ承認。** 管理者が本体 (기기) タブか Telegram 通知の承認ボタンで承認するまで待ちます。
- **サインインした本体はすぐ承認** (既定)。アカウントか本体ごとのログインでサインインした本体は、その場で承認します。サインインしていない本体は引き続き待ちます。
- **すべて承認。** 接続を求める本体を、サインインの有無にかかわらずすべて承認します。承認の段階を丸ごと手放す設定なので、自分の本体しか届かないサーバーでだけ使ってください。

### 自宅ネットワークでの平文 HTTP

CookingFoil 自体は平文の HTTP で通信します。`http://` で接続すると、本体が送るパスワード、セッションを求めるときのアクセスキー、セッショントークンそのものが暗号化されずにネットワークを流れます。同じネットワークにいるほかの人はそれを読めます。セッショントークンは 12 時間で切れ、本体のデバイスキーに結び付いているので被害は狭まりますが、防げるわけではありません。自分だけのネットワークでなければ HTTPS を使ってください。直接ダウンロードのトークンは、平文 HTTP では一切渡しません。

### アクセスを取り消すには

- **本体:** 本体 (기기) タブでアクセスキーを回収します (キーの再発行もできます)。ユーザーは自分が承認した本体を `/pair` で同じように取り消せます。その本体のセッショントークンはすぐに止まります。
- **本体ごとのログイン:** 本体 (기기) タブか `/pair` で取り消します。
- **まだ使われていないクライアントのダウンロード:** 本体 (기기) タブか `/pair` で取り下げます。使われたものはほかの本体と同じ扱いです。
- **アカウント:** ユーザー (사용자) タブで無効にするか削除します。そのアカウントの本体ごとのログイン、セッショントークン、ダウンロードトークンも止まります。パスワードを変えてもセッションは終わります。そのアカウントが承認した本体も本体 (기기) タブで取り消してください。
- **自動化トークン:** 設定 (설정) タブで取り消します。
- **すべてのトークンを一度に:** サーバーを止め、`data/security/download-link.key` を削除してから起動し直します。すべてのセッションとダウンロードのトークンが終わり、本体はアクセスキーでサインインし直します。
- **ロックされたアドレス:** ログ (로그) タブで解除します。

### 組み込みの保護

- パスワードは scrypt のハッシュで保存します。登録トークン、自動化トークン、本体ごとのログインのパスワードは一度だけ表示し、ハッシュだけを残します。
- サインインを `COOK_AUTH_MAX_FAILURES` 回間違えるとそのアドレスをロックし、すべてのアドレスにレート制限があります。管理者コードを間違え続けると、アカウントとアドレスがロックされます。
- 既知の攻撃パス、パストラバーサル、制御文字、長すぎる URL はサインインの前に拒否し、同じロックアウトの回数に数えます。Telegram 通知で知らせることもできます。
- ブラウザーからの書き込みと WebSocket の接続は、サーバー自身のページから来たものだけを受け付けます。WebSocket のメッセージは 4 KB までです。
- 管理者が設定する外部サービスのアドレスは、プライベートネットワークを指すことができません。例外は `COOK_OUTBOUND_PRIVATE_HOSTS` に書いたホストだけです。
- レスポンスには防御用のヘッダー (`nosniff`、`DENY` のフレーミング、リファラーなし) が付きます。拒否はすべて理由付きでログ (로그) タブと `X-CookingFoil-Deny` ヘッダーに残ります。
- 管理ページで保存したシークレットは二度と表示しません。Web アップロードはオンにするまでオフです。

脆弱性の報告は [SECURITY.md](./SECURITY.md) を参照してください。公開の Issue には書かないでください。

## API

ペアリング、登録、`/healthz` を除き、すべてのエンドポイントはショップと同じサインイン (アカウント、本体ごとのログイン、ペアリング済みの本体) の後ろにあります。

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
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | `data/client/` に置いた CookingFoil クライアントのビルド (そのフォルダーに置くか、管理ページのアップロードタブで「クライアント」としてアップロードします) と、その HOME メニューのショートカット。`latest` は、ビルドの隣の `cookingfoil.nro.sig.json` がそのビルドのバージョン、サイズ、sha256 と一致するときだけ `signature` (ビルドした場所で作った Ed25519 署名) を載せます |
| `POST /api/pair/request`, `GET /api/pair/status` | QR による本体ペアリング (QR による本体接続がオンのときのみ)。本体はリクエスト時にランダムな `pairSecret` (16 進数 64 文字) を送り、状態を問い合わせるときに同じ値を `X-Pair-Secret` で送ります。アクセスキーはその値を送った側にだけ渡します |
| `POST /api/pair/enroll` | ダウンロードしたクライアントに入っている登録トークンを `X-Device-Key` とともに送り、自分のアクセスキーに替えます。ダウンロードしたアカウントの下で承認され、24 時間以内に 1 回だけ使えます |
| `GET /api/session` | 本体のパスワード (QR で接続した本体はアクセスキー) を 12 時間のセッショントークンに替えます。以後は同じデバイスキーで `Authorization: Bearer cfs_…` だけを送ります。セッションでセッションを更新することはできず、パスワード変更、ログインや本体の取り消し、ロックアウトですぐに終わります。機能名は `session-token` です |
| `POST /api/pair/rebind` | 同じ本体を新しいデバイスキーに移します (承認、名前、アクセスキー、本体ごとのログインの本体固定)。デバイスキーを本体から作るようになったクライアントが使います。古いキーのアクセスキー、またはその本体を承認したアカウントか、その本体に固定された本体ごとのログインの Basic 認証で証明します。機能名は `device-rebind` です |
| `GET /healthz` | ヘルスチェック。イメージの `HEALTHCHECK` が使います |

クライアントは任意のフィールドを使う前に、`/api/shop/info` の `features` を読んでください。管理 API (`/admin/api/*`) は `/admin/guide` の運用ガイドに説明があります。

## FAQ とトラブルシューティング

**本体が接続できません。** 概要 (개요) タブの警告と、ログ (로그) タブの拒否されたリクエストを見てください。拒否ごとに理由が書いてあります。

**ログ (로그) タブには何も出ないのに、本体はサーバーが応答しないと言います。** リクエストがサーバーまで届いていません。多くの場合、ルーターの DNS が応答していません。本体の DNS を手動で `1.1.1.1` (セカンダリ `8.8.8.8`) などの公開リゾルバーにするか、ルーターが配る DNS を変えてください。

**本体がパスワードでのサインインはオフだと言います。** パスワードで接続する本体は既定でオフです。CookingFoil クライアントを QR か Web 画面のクライアントのダウンロードで接続するか、Tinfoil と CyberFoil を使うなら設定 (설정) タブで「パスワードで接続する本体」をオンにします。

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
