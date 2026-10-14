# CookingFoil

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文**

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

一个面向 Switch 自制程序的个人自托管文件服务器和商店。把文件放在家里的机器上，用一个管理页面管理所有内容，再通过主机上的自制程序客户端安装：CookingFoil 客户端、CyberFoil，或兼容 Tinfoil 的客户端。

网站：<https://jshsakura.github.io/oc-cookingfoil/>

## 目录

- [概述](#概述)
- [功能](#功能)
- [快速开始](#快速开始)
- [文件夹](#文件夹)
- [配置](#配置)
- [管理页面](#管理页面)
- [连接客户端](#连接客户端)
- [反向代理与 HTTPS](#反向代理与-https)
- [可选的直接下载地址](#可选的直接下载地址)
- [安全模型](#安全模型)
- [API](#api)
- [常见问题与故障排查](#常见问题与故障排查)
- [开发](#开发)
- [法律声明](#法律声明)
- [许可证与致谢](#许可证与致谢)

## 概述

CookingFoil 以 Docker 方式运行在你自己的服务器上。它会为你放入的文件查找名称和图标，并把列表提供给主机上的客户端。

- **一个管理页面搞定一切。** 设置、账号、设备、上传、自制程序、补丁、存档和名称都在浏览器里修改。修改立即生效，不需要重启，也不需要手动编辑文件。
- **不附带任何内容。** 不包含游戏、密钥、固件、BIOS 文件或 RetroArch。这些文件夹一开始都是空的，在你放入自己合法拥有的文件之前，用到它们的功能保持关闭。
- **默认私密。** 首次设置需要服务器日志中的代码。主机通过二维码批准或专为那台主机创建的登录信息连接，因此你的账号密码永远不会留在主机上。

| 项目 | 运行于 | 产物 |
|---|---|---|
| CookingFoil 服务器（本仓库） | Docker 主机 | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil 客户端 | 主机的自制程序菜单 | [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) |

网页、首次设置、登录和设备批准页面提供英语、韩语、日语和简体中文。管理页面及其运维指南（`/admin/guide`）目前只有韩语。

## 功能

- **商店列表与分区。** 提供 Tinfoil 格式的索引（`/shop.tfl`、`/shop.json`），以及给 CyberFoil 和 CookingFoil 客户端用的分区列表，推荐行可以在管理页面上安排。
- **名称与图标。** 标题、简介和图片来自 [blawar/titledb](https://github.com/blawar/titledb)；titledb 不认识的文件，则从文件本身读取（需要你自己的 `prod.keys`）。名称的语言顺序和地区都可以设置。
- **图片、价格与评分。** 图标、横幅和截图来自公开的商店图片服务，并缓存在磁盘上。可选的商店价格、热门排序、Steam 评测分数和 IGDB 分数。每个来源都可以关闭。你也可以上传自己的图片。
- **来自 GitHub 的自制程序。** 添加一个仓库后会跟踪它的最新发布（一个 `.nro`，或内含 `.nro` 的 zip）。也可以手动放入应用。每个应用都可以附带 HOME 菜单快捷方式。
- **存档与补丁。** 把存档和补丁（按 SD 卡根目录的结构排列）放在服务器上，在客户端中选择要应用哪些。
- **RetroArch 复古游戏。** 按系统分类的 ROM，来自 libretro-thumbnails 的封面，来自 The Bezel Project 的边框，以及来自 LaunchBox Games Database 的游戏详情（简介、发行商、开发商、发售日期、人数、类型、截图），缺少的部分由 IGDB 补上。你自己提供的 RetroArch 基础包可以分发给主机，也可以为每个游戏生成 HOME 菜单快捷方式。
- **二维码设备配对。** CookingFoil 客户端会显示一个二维码。用手机扫描、登录并批准即可。主机上不会保存任何密码。
- **账号与 Google 登录。** 带有管理员和用户角色的账号密码登录、按主机发放的登录信息，以及可选的 Google 登录，新的 Google 账号需要等待批准。
- **带第二因素的管理页面。** 管理页面会再次要求输入身份验证器（TOTP）代码或单独的管理员密码。自动化令牌让脚本也能使用同样的 API。
- **临时共享收件箱。** 已登录的用户可以留下文件、备注和链接，供运营者之后整理。
- **Telegram 通知。** 设备和账号的批准请求（带批准和拒绝按钮）、锁定、被拦截的攻击探测、临时共享上传以及服务器启动。
- **不中断的下载。** 重启时，服务器用 `503` 和 `Retry-After` 回应新请求，并先让正在进行的下载完成。可选的直接下载地址只承载下载，用短期有效的下载令牌代替登录来打开。

## 快速开始

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

1. 打开 `http://<host>:9080/`，会出现首次设置页面。
2. 输入日志中的设置码。它每次启动都会变化，所以没有日志访问权限的人无法抢先占用服务器。
3. 创建管理员账号并登记身份验证器应用。
4. 管理页面随即打开，其余操作都在那里完成。

给客户端填写你在浏览器中打开的同一个地址。更新时运行 `docker compose pull && docker compose up -d`。

compose 文件的精简版（[完整文件](./docker-compose.yml)中每一行都有注释）：

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

## 文件夹

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

缺少的文件夹由 Docker 自动创建。要把它们全部放到别处，在 `.env` 中设置 `COOK_ROOT=/path/to/cookingfoil`。只移动其中一个时，单独设置它的路径，例如 `COOK_GAMES_PATH=/path/to/games`。其余的是 `COOK_DATA_PATH`、`COOK_KEYS_PATH`、`COOK_RETRO_PATH`、`COOK_PATCHES_PATH`、`COOK_SAVES_PATH` 和 `COOK_HOMEBREW_PATH`。

`retro/` 的内部结构：

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

每个系统对应一个以短 ID 命名的文件夹：`nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` `neocd`。街机游戏保留 FinalBurn Neo 的套装名（例如 `mslug.zip`）。封面按文件名中的英文标题匹配，所以 `My Title (English Title)` 这样的名称效果最好。

RetroArch 基础包是主机开始游玩前需要一次性放入的内容：把 `retroarch.nro`、`retroarch.cfg` 以及 RetroArch 使用的文件夹（`cores/`、`assets/`、`system/` 等）放到 `retro/retroarch/` 下。管理页面会告诉你有游戏的系统还缺哪些 BIOS 文件。CookingFoil 永远不会附带这些文件。

## 配置

大多数设置在管理页面上修改并立即生效。`.env` 中的值只是首次启动时的默认值：一旦你在管理页面上修改了某项设置，就以页面上的值为准，"恢复为 compose 值 (compose 값으로)"会回到 `.env` 中的值。[`.env.example`](./.env.example) 列出并解释了每一个变量。

以下变量需要在管理页面存在之前就确定，或者是有意不放进管理页面的：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | 主机端口 |
| `COOK_ROOT` | `.` | 创建上述文件夹所在的主机目录 |
| `COOK_TRUST_PROXY` | _(空)_ | 允许设置客户端地址的代理跳点，例如 `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | 设为 `false` 时，没有账号的服务器保持开放，而不是把浏览器引导到 `/setup` |
| `COOK_AUTH_USERS` | _(空)_ | 预设账号 `user:pass,user2:pass2`，代替 `/setup` |
| `COOK_ADMIN_PASSWORD` | _(空)_ | 管理员密码和身份验证器都丢失时的恢复手段（12 个字符以上） |
| `COOK_ADMIN_TOTP_SECRET` | _(空)_ | 自己管理身份验证器密钥，代替 `/setup` |
| `COOK_DIRECT_EDGE_SECRET` | _(空)_ | 直接下载代理的共享密钥。见[下文](#可选的直接下载地址) |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_AUTH_MAX_FAILURES` | `1200`, `5` | 每个地址的速率限制，以及锁定前允许的登录失败次数 |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(空)_ | 即使解析到私有、回环或 CGNAT 地址，服务器也可以访问的主机名，例如 tailnet 内的评分服务器。管理页面中设置的其他地址如果指向内部网络，会被拒绝 |

通常在管理页面（设置 (설정) 标签页）修改的设置，全部可以在 `.env` 中预设：

| 设置 | 变量 | 默认值 |
|---|---|---|
| 二维码设备连接 | `COOK_DEVICE_PAIRING` | `false` |
| 主机的批准方式 | `COOK_DEVICE_AUTO_APPROVE` | `true`（已登录的主机自动批准） |
| 公开地址 | `COOK_PUBLIC_BASE_URL` | 由每个请求推断 |
| 网页上传 | `COOK_UPLOADS_ENABLED` | `false` |
| 临时共享收件箱 | `COOK_INBOX_ENABLED` | `true` |
| 名称语言顺序 | `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` |
| titledb 下载、地区、来源 | `COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL` | 开启、内置组合、blawar/titledb |
| 从文件读取图标 | `COOK_EXTRACT_ICONS` | `missing` |
| 商店价格、热门度、图片 | `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` | 开启 |
| 评测分数、复古游戏详情 | `COOK_RATING_SYNC`, `COOK_RETRO_META` | 开启 |
| 每次下载的连接数 | `COOK_DOWNLOAD_MAX_CONNECTIONS` | `4` |
| 直接下载地址、令牌有效期 | `COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL` | 关闭、`21600` 秒 |
| 安全重启 | `COOK_RESTART_RETRY_AFTER`, `COOK_RESTART_GRACE` | `20` 秒、`25` 秒 |

外部服务的密钥（IGDB、SteamGridDB、Dropbox、GitHub、评分服务器）、Google 登录和 Telegram 通知都在管理页面中填写，页面上也会说明每一项去哪里获取。它们全部是可选的。缺少某一项时，只有需要它的那个功能会关闭。

## 管理页面

打开 `/admin`。登录之后会再要求一次身份验证器代码或管理员密码（用 Google 登录的管理员不会被再次询问）。所有修改都保存在 `data/` 下并立即生效。

| 标签页 | 可以做的事 |
|---|---|
| 概览 (개요) | 服务器状态、配置警告，以及游戏名称的来源 |
| 用户 (사용자) | 账号和角色；等待批准的 Google 账号 |
| 设备 (기기) | 批准或拒绝主机、重命名或断开它们，以及为某一台主机创建登录信息 |
| 设置 (설정) | 服务器行为（设备批准、上传、公开地址、欢迎消息、名称与地区、商店数据、评分、下载、安全重启）、外部服务密钥、Google 登录、管理员密码、身份验证器和自动化令牌 |
| 通知 (알림) | Telegram 通知及其涵盖的事件 |
| 日志 (로그) | 被锁定的地址、被拒绝的请求及其原因，以及客户端错误报告 |
| 推荐 (추천) | 客户端主屏幕顶部的行 |
| 资料库 (라이브러리) | 查找和删除文件；编辑、移动或删除补丁和存档；把补丁标记为必需；设置游戏的名称、简介和备注 |
| 上传 (업로드) | 按文件或按文件夹上传游戏、复古 ROM、补丁、存档和自制程序 |
| 临时共享 (임시 공유) | 已登录用户留下的文件、备注和链接 |
| 自制程序 (홈브류) | 添加 GitHub 仓库、开启或关闭应用、移除应用，或把手动放入的应用关联到它的仓库 |
| 复古 (레트로) | 封面和边框、封面上传、显示名称、版本选择，以及删除 ROM |

`/admin/guide` 上的运维指南逐项说明了每项任务，并列出了管理页面使用的 API，因此持有自动化令牌的脚本或 AI 助手也能完成同样的工作。

## 连接客户端

**CookingFoil 客户端。** 下载 [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro)，放进 SD 卡的 `switch/` 文件夹，然后从自制程序菜单打开。输入服务器地址。开启二维码设备连接（设置 (설정)，服务器行为）后，主机会显示一个二维码：用手机扫描、登录并批准。连接之后，客户端会从你的服务器自动更新，也可以为自己创建 HOME 菜单快捷方式。

**CyberFoil 或兼容 Tinfoil 的客户端。** 把服务器添加为商店：

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

在家庭网络中，也可以改用服务器的内网地址，协议用 `http`，端口用 `9080`。用户名和密码建议使用在设备 (기기) 标签页上创建的按主机登录信息，这样更安全：它只能读取列表，绑定到第一台使用它的主机，并且随时可以撤销。你自己的账号也可以用。在 Tinfoil 中，进入 *File Browser*，按 `+`，然后填写同样的字段。

原版 Tinfoil 和 CyberFoil 无法通过二维码配对。它们始终用账号或按主机登录信息登录，与已配对的主机并行使用。

## 反向代理与 HTTPS

CookingFoil 只提供普通 HTTP。要从家外访问，请把它放在终止 HTTPS 的反向代理或隧道后面（nginx、Caddy、Traefik、Cloudflare Tunnel 等）。

可直接使用的 Caddy（一个栈内完成 HTTPS）、nginx 和 Cloudflare Tunnel 配置文件在 [`examples/`](examples/) 中。

- 把 `COOK_TRUST_PROXY` 设为允许设置客户端地址的跳点，不要多设：代理在同一台主机或私有网络中时，用 `loopback, uniquelocal`。`true` 会信任所有跳点，只有在除了经过代理之外没有任何途径能访问服务器时才安全。不设置的话，所有客户端看起来都是代理的同一个地址，一个陌生人的登录失败就可能把所有人都锁在外面。管理页面发现这种情况时会给出警告。`X-Forwarded-Host` 和 `X-Forwarded-Proto` 也只在来自这些跳点时才被采信；来自其他地方时，服务器使用连接本身的 `Host`（设置了 `COOK_PUBLIC_BASE_URL` 时用它）。
- 让代理转发 `X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host`。下载和图片的 URL 是绝对地址，由这些请求头生成。如果你的代理会改写 `Host`，请在管理页面上设置公开地址（或 `COOK_PUBLIC_BASE_URL=https://shop.example.org`）。
- 允许大响应和长时间请求。主机会用大量 Range 请求下载，单个文件可能有几十 GB。
- 放在 CookingFoil 前面的开发服务器（Vite 等）可能会用 `403` 拒绝未知的 `Host` 请求头。在怀疑代理之前，先用 `curl -H "Host: shop.example.org" http://127.0.0.1:9080/` 直接测试源站。

## 可选的直接下载地址

有些部署让商店经过隧道或 CDN，而它们对超大文件很慢或有限制。直接下载地址让主动请求它的客户端从第二个只承载下载的 HTTPS 地址下载，列表和登录仍然留在主地址上。

工作方式：

1. 与容器位于同一台主机上的反向代理提供例如 `https://dl.example.org` 的地址。它只转发携带 `Authorization: Bearer …` 的 `GET` 和 `HEAD` 请求，自己设置 `X-Forwarded-For`，把 `Host` 设为直接地址（如果有端口，带上端口），并添加 `X-CookingFoil-Edge: <secret>`。它不能转发经过你主隧道而来的请求。
2. 同一个密钥以 `COOK_DIRECT_EDGE_SECRET` 写入 `.env`。它永远不是管理页面上的设置。没有它，直接地址不提供任何内容。
3. 地址填写在管理页面（设置 (설정)，下载）或 `COOK_PUBLIC_DIRECT_BASE_URL` 中，必须是 `https://`。
4. 已登录、并通过 HTTPS 发送 `X-CookingFoil-Features: direct-token` 的客户端会收到 `X-CookingFoil-Download-Token` 响应头，它列表中的下载 URL 会指向直接地址。客户端在那里把令牌作为 Bearer 令牌发送。

令牌由服务器签名（使用 `data/security/` 中随机密钥的 HMAC-SHA256），有效期为 `COOK_DOWNLOAD_LINK_TTL` 秒（默认 6 小时），一旦签发对象的账号或主机不能再登录，令牌就立即失效。拒绝响应带有 `X-CookingFoil-Token: invalid | expired | revoked | blocked`，发送过多无效令牌的地址会被暂时封禁。没有声明此功能的客户端（Tinfoil、CyberFoil、浏览器）以及通过普通 HTTP 的请求，看到的列表与以前完全相同。经过 Cloudflare 到达、且 `CF-IPCountry` 不是 `src/security/download-links.js` 中固定国家的请求，会保留普通 URL。

包含 DNS 证书和 DDNS 的完整 Caddy 配置在 [`examples/direct-download/`](examples/direct-download/) 中。

一个最小的 nginx 示例（请按需调整证书、端口和密钥）：

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

## 安全模型

- **用日志中的代码认领设置。** 在管理员存在之前，`/setup` 需要启动时打印的代码，而且它每次都会变化。
- **密码**以 scrypt 哈希保存。多次失败会锁定该地址（`COOK_AUTH_MAX_FAILURES`、`COOK_LOCKOUT_TTL_HOURS`），每个地址都有速率限制。
- **管理页面**在登录之外还需要第二因素：TOTP 代码或单独的管理员密码。输错代码会锁定账号和地址。
- **主机**使用设备密钥和批准后签发的访问密钥连接，或使用只能读取列表并绑定到一台主机的按主机登录信息连接。批准方式可以是手动、对已登录的主机自动批准，或对所有主机自动批准。
- **自动化令牌**以创建它的管理员身份行事，只在 `/admin/api/` 下有效，并且不能修改账号、登录方式或令牌。
- 直接地址的**下载令牌**有效期短、经过签名、绑定到账号和主机，并且只接受来自持有边缘密钥的本地代理的请求。
- 在管理页面上保存的**密钥**不会再次显示。密钥和令牌都存放在 `data/` 下，所以请保护并备份这个文件夹。
- 响应带有防护性请求头（`nosniff`、`DENY` 框架限制、不发送 referrer），已知的攻击路径在登录之前就会被拒绝。

如需报告漏洞，请参阅 [SECURITY.md](./SECURITY.md)。

## API

除了配对和 `/healthz` 以外，所有端点都位于与商店相同的登录之后（账号、按主机登录信息或已配对的设备）。

| 端点 | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 格式的索引 |
| `GET /api/shop/sections` | 给 CyberFoil 和 CookingFoil 客户端的分区列表 |
| `GET /api/shop/info` | 服务器版本、下载提示，以及客户端可以依赖的 `features` |
| `GET /api/title/:id?lang=`, `/api/title/:id/extras` | 单个条目的详情及其附加文件 |
| `GET /api/shop/icon/:id`, `/api/shop/banner/:id`, `/api/shop/screenshot/:id/:n` | 图片 |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/file?path=`, `/bundle`, `/archive`, `/forwarder` | 自制程序应用（单个 `.nro` 或整个 `switch/<app>/` 文件夹）及其 HOME 菜单快捷方式。在管理页面上关闭的应用不会列出 |
| `GET /api/patches?lang=`, `/api/patches/:id/download` | 补丁 |
| `GET /api/saves?lang=`, `/api/saves/:id/download` | 存档文件 |
| `GET /api/retro/systems`, `/api/retro/games`, `/api/retro/games/:id/rom`, `/bundle`, `/boxart`, `/bezel.png`, `/forwarder.nsp` | 复古游戏及其图片，在复古文件夹中有 ROM 时可用 |
| `GET /api/retro/base-pack/manifest`, `/api/retro/base-pack/bundle` | 你提供的 RetroArch 基础包 |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | 保存在 `data/client/` 中的 CookingFoil 客户端构建及其 HOME 菜单快捷方式 |
| `POST /api/pair/request`, `GET /api/pair/status` | 二维码设备配对（仅在开启二维码设备连接时可用）。设备在请求时发送一个随机的 `pairSecret`（64 位十六进制），查询状态时用 `X-Pair-Secret` 发送同一个值；访问密钥只下发给发送该值的一方 |
| `GET /healthz` | 健康检查，供镜像的 `HEALTHCHECK` 使用 |

客户端在使用可选字段之前，应先读取 `/api/shop/info` 中的 `features`。管理 API（`/admin/api/*`）在 `/admin/guide` 的运维指南中有说明。

## 常见问题与故障排查

**主机无法连接。** 查看概览 (개요) 标签页上的警告和日志 (로그) 标签页上被拒绝的请求。每条拒绝都写明了原因。

**日志 (로그) 标签页上什么都没有，但主机说服务器没有响应。** 请求根本没有到达服务器。常见原因是路由器的 DNS 没有响应。把主机的 DNS 手动设为 `1.1.1.1`（备用 `8.8.8.8`）这样的公共解析器，或者修改路由器分发的 DNS。

**在代理后面，所有客户端同时被锁定。** 没有设置 `COOK_TRUST_PROXY`，所有客户端共用了代理的地址。请参阅[反向代理与 HTTPS](#反向代理与-https)。

**我自己的地址被锁定了。** 在日志 (로그) 标签页上解锁。如果进不了管理页面，用 `COOK_RESET_LOCKOUTS=true` 启动一次，然后再删掉它。

**我丢失了身份验证器。** 如果设置过管理员密码，用它登录。如果两者都丢失了，在 `.env` 中写入 `COOK_ADMIN_PASSWORD`（12 个字符以上），重启后用它登录。

**名称显示成了文件名。** titledb 还在下载中，或者该标题不在 titledb 里。把你自己的 `prod.keys` 放进 `keys/`，以便从文件中读取名称和图标，并查看概览 (개요) 标签页上的名称状态面板。

**CyberFoil 显示了无法安装的行。** 保持 `COOK_EMIT_TITLEDB` 关闭。它只用于原版 Tinfoil。

**复古游戏缺少封面。** 在复古 (레트로) 标签页上使用"获取缺失项 (빠진 것 모두 받기)"，或手动匹配游戏。GitHub 令牌（设置 (설정)）可以解除 GitHub 每小时 60 次请求的限制。

## 开发

需要 Node.js 20 或更新版本（镜像和 CI 使用 Node 22）。

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

工作流程、提交风格和四种语言的规则请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 法律声明

CookingFoil 是一个独立的开源项目，与任天堂或任何其他平台方没有关联，也未获得其认可或赞助。这里使用的名称仅用于识别。

本项目不包含任何游戏、密钥、固件、BIOS 文件、RetroArch 或其他受版权保护的内容。文件由你自己提供，并由你负责确保有权使用它们，例如你所拥有游戏的备份，以及从你自己的主机中导出的密钥。请不要用 CookingFoil 向无权获得这些内容的人分享内容。

## 许可证与致谢

MIT，见 [LICENSE](./LICENSE)。CookingFoil 最初是 Vinicios Clarindo 的 [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat)（MIT）的分支。

本项目基于以下成果：

- [blawar/titledb](https://github.com/blawar/titledb)，提供标题名称、简介和图片地址，运行时获取。
- [CyberFoil](https://github.com/luketanti/CyberFoil) 和 Tinfoil，服务器使用它们的商店格式。
- [nstool](https://github.com/jakcron/nstool)（MIT）和 [nsz](https://github.com/nicoboss/nsz)（MIT），打包在镜像中。
- [hacBrewPack](https://github.com/The-4n/hacBrewPack)（GPL-2.0）和 [nx-hbloader](https://github.com/switchbrew/nx-hbloader)（ISC），用于 HOME 菜单快捷方式。
- [libretro-thumbnails](https://github.com/libretro-thumbnails) 的封面和 [The Bezel Project](https://github.com/thebezelproject) 的边框，运行时获取。
- [LaunchBox Games Database](https://gamesdb.launchbox-app.com/)、[IGDB](https://www.igdb.com/) 和 Steam，提供游戏详情和分数，运行时获取。
- [FinalBurn Neo](https://github.com/finalburnneo/FBNeo) 的套装列表，用于街机名称。
- [Lucide](https://lucide.dev) 图标（ISC），以及 Baloo 2 和 IBM Plex Sans KR 字体（SIL OFL 1.1）。

[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 列出了所有打包组件及其许可证。
