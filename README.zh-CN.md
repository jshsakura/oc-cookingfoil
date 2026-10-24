<div align="center">
  <h1><img src="brand/cookingfoil-readme-256.png" alt="CookingFoil" width="192" height="192" /></h1>
  <p><strong>文件放在自己的服务器，收藏在主机上管理。</strong></p>
</div>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文**

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

一个面向 Switch 自制程序的个人自托管文件服务器和商店。把文件放在家里的机器上，用一个管理页面管理所有内容，再用主机上的 CookingFoil 客户端安装。

<p align="center">
  <a href="https://jshsakura.github.io/oc-cookingfoil/?lang=zh"><img src="brand/buttons/website-zh.svg" alt="网站" width="160" height="44" /></a>
  <a href="README.zh-CN.md#快速开始"><img src="brand/buttons/setup-zh.svg" alt="安装指南" width="160" height="44" /></a>
  <a href="README.zh-CN.md#连接客户端"><img src="brand/buttons/connect-zh.svg" alt="连接主机" width="160" height="44" /></a>
</p>

![CookingFoil](site/screenshots/en/home-no-art.webp)

使用示例数据的实际英文界面，缺少图标时显示应用原本的首字母图块。

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
- [安全](#安全)
- [API](#api)
- [常见问题与故障排查](#常见问题与故障排查)
- [开发](#开发)
- [法律声明](#法律声明)
- [许可证与致谢](#许可证与致谢)

## 概述

CookingFoil 以 Docker 方式运行在你自己的服务器上。它会为你放入的文件查找名称和图标，并把列表提供给主机上的客户端。

- **一个管理页面搞定一切。** 设置、账号、设备、上传、自制程序、补丁、存档和名称都在浏览器里修改。修改立即生效，不需要重启，也不需要手动编辑文件。
- **不附带任何内容。** 不包含游戏、密钥、固件、BIOS 文件或 RetroArch。这些文件夹一开始都是空的，在你放入自己合法拥有的文件之前，用到它们的功能保持关闭。
- **默认私密。** 首次设置需要服务器日志中的代码。主机通过二维码批准，或通过从服务器网页下载的客户端，拿到只属于它的访问密钥后连接，因此你的账号密码永远不会留在主机上。主机持续访问时从不使用密码；账号和密码只能在配对时用一次，用来自动批准这台主机。

| 项目 | 运行于 | 产物 |
|---|---|---|
| CookingFoil 服务器（本仓库） | Docker 主机 | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil 客户端 | 主机的自制程序菜单 | 由每台服务器自己分发：网页上的“下载客户端”卡片 |

CookingFoil 客户端不在 GitHub 上发布。服务器的 `data/client/` 中有客户端构建时（放进这个文件夹，或在管理页面的上传 (업로드) 标签页以“客户端”上传），登录该服务器的用户就可以在网页上下载。在管理页面把客户端构建来源设为 `github` 后，服务器还会跟随客户端仓库（`jshsakura/oc-cookingfoil-client`）的最新发布，并分发两者中版本较高的构建。

网页、首次设置、登录和设备批准页面提供英语、韩语、日语和简体中文，并可选择浅色或深色主题。管理页面及其运维指南（`/admin/guide`）目前只有韩语。

## 功能

- **商店分区。** 给 CookingFoil 客户端和网页用的分区列表，推荐行可以在管理页面上安排；另有给持自动化令牌的脚本用的扁平文件目录（`/shop.json`）。
- **名称与图标。** 标题、简介和图片来自 [blawar/titledb](https://github.com/blawar/titledb)；titledb 不认识的文件，则从文件本身读取（需要你自己的 `prod.keys`）。名称的语言顺序和地区都可以设置。
- **图片、价格与评分。** 图标、横幅和截图来自公开的商店图片服务，并缓存在磁盘上。可选的商店价格、热门排序、Steam 评测分数和 IGDB 分数。每个来源都可以关闭。你也可以上传自己的图片。
- **来自 GitHub 的自制程序。** 添加一个仓库后会跟踪它的最新发布（一个 `.nro`，或内含 `.nro` 的 zip）。也可以手动放入应用。每个应用可以标为工具或移植版、可以关闭，也可以附带 HOME 菜单快捷方式。
- **存档与补丁。** 把存档和补丁（按 SD 卡根目录的结构排列）放在服务器上，在客户端中选择要应用哪些。补丁可以标为必需，并记录它对应的游戏更新版本。
- **RetroArch 复古游戏。** 按系统分类的 ROM，来自 libretro-thumbnails 的封面，来自 The Bezel Project 的边框，以及来自 LaunchBox Games Database 的游戏详情（简介、发行商、开发商、发售日期、人数、类型、截图），缺少的部分由 IGDB 补上。同一游戏的多个版本（街机的母版与克隆版，或多种语言和地区的版本）合并为一张卡片显示，其他版本再点一下即可看到。你自己提供的 RetroArch 基础包可以分发给主机，也可以为每个游戏生成 HOME 菜单快捷方式。
- **每台主机用自己的密钥连接。** 用手机批准 CookingFoil 客户端显示的二维码，或者让从网页下载的客户端直接连接。无论哪种方式，主机都会拿到自己的访问密钥，不会保存任何密码。
- **账号与 Google 登录。** 带有管理员和用户角色的账号密码登录，以及可选的 Google 登录，新的 Google 账号需要等待批准。
- **带第二因素的管理页面。** 管理页面会再次要求输入身份验证器（TOTP）代码或单独的管理员密码。自动化令牌让脚本也能使用同样的 API。
- **临时共享收件箱。** 已登录的用户可以留下文件、备注和链接，供运营者之后整理。
- **Telegram 通知。** 设备和账号的批准请求（带批准和拒绝按钮）、锁定、被拦截的攻击探测、临时共享上传以及服务器启动。
- **不中断的下载。** 重启时，服务器用 `503` 和 `Retry-After` 回应新请求，并先让正在进行的下载完成。可选的直接下载地址只承载下载，用短期有效的下载令牌代替登录来打开。

## 快速开始

需要 Docker 和 Compose v2(`docker compose`，2.9 或更高版本)。镜像可在 amd64 和 arm64 上运行。群晖 NAS 请按下方 [群晖 NAS](#群晖-nas) 操作。

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
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
      - .env
    environment:
      PUID: ${PUID:-1000}
      PGID: ${PGID:-1000}
    ports:
      - "9080:80"
    volumes:
      - ./storage:/storage
```

### 群晖 NAS

1. 在套件中心安装 **Container Manager**(DSM 7.2 或更高版本)。
2. 在 File Station 中创建 `docker/cookingfoil` 之类的文件夹，放入 `docker-compose.yml` 和 `.env`(`.env.example` 的副本)。在任意电脑上用 `openssl rand -base64 32` 生成密钥，填入 `.env` 的 `COOK_SECRET_KEY`。
3. 把 `.env` 中的 `PUID` 和 `PGID` 设为文件夹所有者账户的值。通过 SSH 运行 `id <账户>` 可查看。第一个管理员账户通常是 `1026`，`users` 用户组是 `100`。
4. 要把所有内容放在已有的共享文件夹中，设置路径(例如 `COOK_STORAGE_PATH=/volume1/cookingfoil`)，并给该账户读写权限。
5. 在 Container Manager 中依次打开 **项目**、**新增**，选择第 2 步的文件夹，直接使用其中的 `docker-compose.yml`，完成向导。
6. 设置码在 **容器**、`cookingfoil`、**日志** 中。打开 `http://<NAS 地址>:9080/`。如果开启了 DSM 防火墙，请放行 9080 端口。

## 文件夹

```
cookingfoil/
├── docker-compose.yml
├── .env              # optional; defaults for the first start
└── storage/          # the one folder mounted at /storage; the server makes the rest
    ├── incoming/     # drop box: files put here are sorted into the folders below
    ├── games/        # sorted Switch games, one folder per game with update/ and DLC/
    ├── homebrew/     # .nro apps, app folders, or a release zip left in its own folder
    ├── retro/        # retro ROMs, art and the RetroArch base pack
    ├── patches/      # patches by base title id, and homebrew/<app>/
    ├── saves/        # save files by title id, and homebrew/<app>/
    ├── keys/         # recommended: your own prod.keys (or upload it on the admin page)
    └── data/         # cache, accounts and every setting saved on the admin page. Back this one up
```

存储文件夹默认是 `docker-compose.yml` 旁边的 `./storage`，可用 `.env` 中的 `COOK_STORAGE_PATH` 修改。服务器启动时会在其中创建上面的文件夹，也可以用 `COOK_<名称>_DIR` 把其中某一个放到别处。

要让服务器代为整理，把文件放进 `storage/incoming/`。文件一分钟内没有变化后，服务器从文件内的信息(没有 `prod.keys` 时用文件名或票据)读出标题 ID 和版本，把文件改名为 `游戏名 [TITLEID][vN].扩展名`，移到 `games/` 中每个游戏一个文件夹，本体旁边放 `update/` 和 `DLC/`。游戏名依次取管理页面设定的名称、titledb、文件内的 NACP(有 `prod.keys` 和 nstool 时从 NSP、NSZ、XCI、XCZ 读取)、去掉发布站标记、标签和浏览器添加的 ` (1)` 的原文件名，含乱码的名称会被跳过。一起到来的本体和更新使用同一个名称。已有文件夹的游戏沿用原文件夹，新游戏以其名称新建文件夹。titledb 不认识的游戏用本体或更新 NACP 中的名称建文件夹，没有时用本体的文件名。只有 DLC 时，如果该游戏已有文件夹，或 titledb 或管理页面知道游戏名称，就会移动；否则留到本体或更新到来，并在管理页面中说明。文件名没有意义的 DLC(如 `dlc2`)命名为 `游戏名 DLC n`。复古 ROM 放进以机种命名的文件夹(`incoming/snes/`)后移到 `retro/`，单独的 `.nro` 移到 `homebrew/`。不会覆盖任何文件，无法放置的文件留在 `incoming/`，原因显示在管理页面(游戏库，临时文件夹)。服务器按位置而不是名称或内容识别临时文件夹，因此不会把 `games/` 中的文件夹误当作待整理的内容。

**从分开挂载的服务器迁移。** 新安装只挂载存储文件夹。文件仍在分开的文件夹(`./games`、`./data`、`./keys` 等，或 `COOK_<名称>_PATH` 指定的位置)中的服务器需同时使用 `docker-compose.legacy.yml`：用 `docker compose -f docker-compose.yml -f docker-compose.legacy.yml up -d` 启动，或在 `.env` 中写入 `COMPOSE_FILE=docker-compose.yml:docker-compose.legacy.yml`。不加这个文件启动时，这些文件夹不会被挂载，服务器以空状态启动，磁盘上的文件不受影响。加上后，有文件的旧文件夹继续使用，并在管理页面的概览中提示；空文件夹会被忽略。要完成迁移，先停止服务器，把各文件夹的内容按上面的名称移进存储文件夹，去掉 legacy 文件后再启动。迁移过程中不会覆盖任何文件；`games/incoming/` 中的内容在没有同名项且不在其他磁盘上时移到 `incoming/`，留下的会显示在概览中。

服务器以用户 `PUID`、用户组 `PGID` 运行(`.env` 未设置时为 1000、1000)，因此它在这些文件夹中写入的文件归你所有。在主机上运行 `id` 可查看自己的值。启动时它把数据文件夹交给该用户；无法写入的游戏库文件夹会连同修复命令一起写进日志，其他内容不做改动。`PUID=0` 以 root 运行；在 compose 文件中写 `user:` 则按该用户原样运行。

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

旧变量 `TINFOIL_HAT_PORT` 不再生效。服务器监听端口使用 `COOK_PORT` (默认 `80`) 设置；Docker 用户通常通过 `COOK_HOST_PORT` 修改对外发布的端口。

大多数设置在管理页面上修改并立即生效。`.env` 中的值只是首次启动时的默认值：一旦你在管理页面上修改了某项设置，就以页面上的值为准，"恢复为 compose 值 (compose 값으로)"会回到 `.env` 中的值。[`.env.example`](./.env.example) 列出并解释了每一个变量。

以下变量需要在管理页面存在之前就确定，或者是有意不放进管理页面的：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `COOK_SECRET_KEY` | _(必填)_ | 加密数据目录中保存的密钥类信息(AES-256-GCM)。用 `openssl rand -base64 32` 生成并妥善保存，新密钥无法打开旧密钥加密的内容 |
| `COOK_HOST_PORT` | `9080` | 主机端口 |
| `PUID` / `PGID` | `1000` / `1000` | 服务器运行时使用的用户和用户组，它写入的文件归你所有。`0` 表示以 root 运行 |
| `COOK_TRUST_PROXY` | _(空)_ | 允许设置客户端地址的代理跳点，例如 `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | 设为 `false` 时，没有账号的服务器保持开放，而不是把浏览器引导到 `/setup` |
| `COOK_AUTH_USERS` | _(空)_ | 预设账号 `user:pass,user2:pass2`，代替 `/setup`。第一个账号是管理员，其余为普通用户 |
| `COOK_ADMIN_PASSWORD` | _(空)_ | 管理员密码和身份验证器都丢失时的恢复手段（12 个字符以上） |
| `COOK_ADMIN_TOTP_SECRET` | _(空)_ | 自己管理身份验证器密钥，代替 `/setup` |
| `COOK_DIRECT_EDGE_SECRET` | _(空)_ | 直接下载代理的共享密钥。见[下文](#可选的直接下载地址) |
| `COOK_DIRECT_COUNTRIES` | _(空)_ | 可以使用直接下载地址的国家，填 ISO 代码（`KR,JP`）。Cloudflare 判定在其他国家的客户端继续使用普通 URL。留空则不限国家 |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_RATE_LIMIT_BURST` | `1200`, `300` | 一个地址每分钟可以发送的请求数，以及一次可以同时发送的请求数 |
| `COOK_AUTH_MAX_FAILURES`, `COOK_LOCKOUT_TTL_HOURS` | `5`, `0` | 锁定地址前允许的登录失败次数，以及锁定的时长（`0` 表示直到管理员解锁） |
| `COOK_ADMIN_SESSION_HOURS` | `8` | 管理页面登录保持的时长 |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(空)_ | 即使解析到私有、回环或 CGNAT 地址，服务器也可以访问的主机名，例如 tailnet 内的 titledb 镜像。管理页面中设置的其他地址如果指向内部网络，会被拒绝 |

通常在管理页面（设置 (설정) 标签页）修改的设置，全部可以在 `.env` 中预设：

| 设置 | 变量 | 默认值 |
|---|---|---|
| 二维码设备连接（网页的“下载客户端”也需要它） | `COOK_DEVICE_PAIRING` | `true` |
| 主机的批准方式 | `COOK_DEVICE_AUTO_APPROVE` | `true`：在配对时发送一次账号和密码的主机立即批准。`false`：管理员逐台批准。`all`：所有请求的主机都批准 |
| 每个账户的主机数 | `COOK_DEVICE_LIMIT` | 一个账户可以拥有的已批准主机数量，无论以何种方式批准都计算在内。默认 `10`，`0` 表示不限制。可在设置标签页更改 |
| 下载每小时连接的主机数 | `COOK_ENROLL_PER_HOUR` | 一个账户下载的客户端在一小时内可以自动连接的不同主机数量，合计该账户的所有下载。默认 `5`，范围 1 到 50。可在设置标签页更改 |
| 公开地址 | `COOK_PUBLIC_BASE_URL` | 由每个请求推断 |
| 网页上传 | `COOK_UPLOADS_ENABLED` | `false` |
| 临时共享收件箱 | `COOK_INBOX_ENABLED` | `true` |
| 名称语言顺序 | `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` |
| titledb 下载、地区、来源 | `COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL` | 开启、内置组合、blawar/titledb |
| 客户端构建来源 | `COOK_CLIENT_SOURCE`, `COOK_CLIENT_RELEASE_REPO`, `COOK_CLIENT_RELEASE_TAG` | `manual`：只使用上传的构建。`github` 还会跟随 `jshsakura/oc-cookingfoil-client` 的最新发布（设置标签时跟随该标签） |
| 从文件读取图标 | `COOK_EXTRACT_ICONS` | `missing` |
| 商店价格、热门度、图片 | `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` | 开启 |
| 评测分数、复古游戏详情 | `COOK_RATING_SYNC`, `COOK_RETRO_META` | 开启 |
| 预建复古机种文件夹 | `COOK_RETRO_SCAFFOLD` | 开启 |
| 每次下载的连接数 | `COOK_DOWNLOAD_MAX_CONNECTIONS` | `4` |
| 直接下载地址、令牌有效期 | `COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL` | 关闭、`21600` 秒 |
| 安全重启 | `COOK_RESTART_RETRY_AFTER`, `COOK_RESTART_GRACE` | `20` 秒、`25` 秒 |
| 文件夹同步、每日备份 | `COOK_SYNC_HOURS`, `COOK_BACKUP_DAYS` | 每 `6` 小时，保留 `14` 天（`0` 表示关闭） |

外部服务的密钥（IGDB、SteamGridDB、Dropbox、GitHub）、Google 登录和 Telegram 通知都在管理页面中填写，页面上也会说明每一项去哪里获取。它们全部是可选的。缺少某一项时，只有需要它的那个功能会关闭。

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

主机用 CookingFoil 客户端连接，方式有两种。两种都会给主机一个只属于它的访问密钥，默认都开启。主机持续访问时从不使用密码；账号和密码只能在配对时用一次，用来自动批准这台主机。Tinfoil 和 CyberFoil 不是受支持的客户端。

**1. CookingFoil 客户端，扫码连接。** 从自制程序菜单打开客户端并输入服务器地址，屏幕上会出现二维码和 8 位设备码。用手机扫描二维码，或在 `/pair` 输入设备码，然后登录并批准。主机会收到自己的访问密钥。批准方式为“已登录的主机立即批准”（默认）时，在客户端中输入账号和密码也会当场批准；密码只在这时检查一次，此后主机只用访问密钥连接。

**2. CookingFoil 客户端，从网页下载。** 登录服务器的网页，使用“下载客户端”卡片。你会得到一个 zip，里面有 `switch/cookingfoil/cookingfoil.nro`，以及写有本服务器地址和注册令牌的 `config.json`。把 `switch/` 文件夹复制到 SD 卡，然后打开客户端。第一次启动时，客户端会用令牌换取自己的访问密钥（`POST /api/pair/enroll`），并以你的账号批准，不需要扫码。下载后 1 小时内最多 `COOK_ENROLL_PER_HOUR` 台主机会自动连接（默认 5，可在设置标签页更改），更多主机请用二维码批准。这个数量按该账户所有下载合计、在任意 1 小时内计算，所以重新下载也不会增加。手动批准（`COOK_DEVICE_AUTO_APPROVE=false`）时一次下载只连接一台主机。重新下载会结束同一账户之前的下载，已连接的主机保持不变。未能用令牌连接的主机会像只知道服务器地址的主机一样等待批准。下载可以在同一页面或管理页面的设备 (기기) 标签页撤回。无论以何种方式批准，一个账户最多拥有 `COOK_DEVICE_LIMIT` 台主机（默认 10，0 表示不限制，可在设置标签页更改）。在用掉之前，请像对待钥匙一样保管这个 zip。

无论用哪种方式，客户端都会把访问密钥换成 12 小时的会话令牌（`GET /api/session`），之后只发送这个令牌。连接之后，客户端会从你的服务器自动更新，也可以为自己创建 HOME 菜单快捷方式。换用新设备密钥的主机可以通过 `POST /api/pair/rebind` 保留原来的批准。

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
4. 已登录、并通过 HTTPS 发送 `X-CookingFoil-Features: direct-token` 的客户端会收到 `X-CookingFoil-Download-Token` 响应头，它列表中的下载 URL 会指向直接地址。同时返回的 `X-CookingFoil-Download-Origin` 是直接地址的 origin，客户端只在那里把令牌作为 Bearer 令牌发送。

令牌由服务器签名（使用加密保存在 `data/security/security.db` 中的随机密钥的 HMAC-SHA256），有效期为 `COOK_DOWNLOAD_LINK_TTL` 秒（默认 6 小时），一旦签发对象的账号或主机不能再登录，令牌就立即失效。拒绝响应带有 `X-CookingFoil-Token: invalid | expired | revoked | blocked`，发送过多无效令牌的地址会被暂时封禁。没有声明此功能的客户端（旧版客户端、浏览器）以及通过普通 HTTP 的请求，看到的列表与以前完全相同。经过 Cloudflare 到达、且 `CF-IPCountry` 不在 `COOK_DIRECT_COUNTRIES`（设置时）中的请求，会保留普通 URL。

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

## 安全

CookingFoil 的设计前提是放在你自己的代理后面、面向互联网运行。因此它以锁定状态启动，只开放你开启的功能。本节说明需要设置什么、每种接入方式信任什么，以及如何收回访问权限。

### 推荐设置

1. **每台主机都通过扫码或网页的“下载客户端”连接**，让每台主机都有一把可以单独撤销的密钥。主机上不保存任何密码。
2. **保留管理页面的第二因素。** 在首次设置时登记身份验证器应用。也可以用单独的管理员密码（`COOK_ADMIN_PASSWORD`，至少 12 个字符）代替，但它要和所有商店账号的密码都不同。
3. **从外部只走 HTTPS。** 让请求经过终止 HTTPS 的反向代理或隧道到达服务器，不要把明文 HTTP 端口暴露到互联网。
4. **`COOK_TRUST_PROXY` 只填写你的代理跳点**，不要放得更宽。请参阅[反向代理与 HTTPS](#反向代理与-https)。
5. **有意识地选择批准方式。**“已登录的主机立即批准”（默认）和“管理员逐台批准”是安全的选择。“全部批准”只用于只有你自己的主机能访问的服务器。
6. **保护并备份 `data/`。** 账号、设备密钥和签名密钥都在这里。

### 每种接入方式信任什么

| 谁 | 用什么证明身份 | 可以做什么 |
|---|---|---|
| 网页用户 | 账号和密码，或 Google 登录（新的 Google 账号需要等待批准） | 浏览、批准自己的主机、下载客户端、使用临时共享，开启网页上传时可以上传 |
| 管理员 | 具有管理员角色的账号，加上身份验证器代码或管理员密码 | 管理页面上的一切操作。管理员会话持续 `COOK_ADMIN_SESSION_HOURS` |
| 已配对的主机 | 设备密钥和访问密钥，之后是绑定同一设备密钥的 12 小时会话令牌。密码只在配对时算一次，别处一概不算 | 读取列表和下载 |
| 自动化令牌 | `Authorization: Bearer cft_…` | 以创建它的管理员身份使用 `/admin/api/` 下的管理 API。不能创建或撤销令牌，也不能修改管理员的登录方式、批准设备、修改通知，或修改与登录和地址相关的设置 |
| 直接下载地址 | 经过持有边缘密钥的本地代理送来的短期下载令牌 | 只有 `GET` 和 `HEAD` 下载 |

修改所有人都能看到的内容（图片、简介、游戏文件夹中的文件）以及查看上传列表，只限管理员账号。普通用户账号和已配对的主机只能读取。

### 磁盘上保存什么

- 账号密码只保存 scrypt 哈希。
- 主机访问密钥和自动化令牌只保存 SHA-256 哈希。原始值只在创建时显示一次。
- 服务器需要读回的密钥类信息(管理员身份验证器密钥、会话和下载令牌的签名密钥、Google 与 IGDB 客户端密钥)用 `COOK_SECRET_KEY` 以 AES-256-GCM 加密保存。密钥放在 `.env` 而不是数据目录中，只复制数据目录无法打开其中任何一项。
- 请另外保存 `COOK_SECRET_KEY`。没有它服务器无法启动，新密钥也无法打开旧密钥加密的内容。
- 账号、已批准的主机、主机专用登录、令牌、保存的设置、审计日志和加密的密钥保存在 `data/security/security.db`（SQLite）中，只有服务器账户可以读取(0600)。它和下面的索引不同，无法重建，请与数据文件夹一起备份。
- 读取存档、自制软件和复古游戏文件夹得到的列表及文件哈希保存在 `data/cookingfoil.db`（SQLite）中，所以重启后也能立刻列出。它只是文件夹的索引，删除后服务器会重新读取文件夹。
- 媒体库的所有文件夹每 `COOK_SYNC_HOURS` 小时从头重新读取一次，在设置页按 **立即同步** 会马上读取。新文件由文件夹监视在到达时发现，这一步补上遗漏的部分。
- 每天一次，把安全数据库和手动维护的文件（下载与通知记录、NSZ 队列、说明、手动修改的名称、自制软件来源、上传的图片）复制到 `data/backups/<日期>/`（0700），保留 `COOK_BACKUP_DAYS` 天。在设置页按 **立即备份** 会马上生成。ROM、图片和缓存会自行恢复，所以不包含在内。若要防备磁盘故障，请把 `data/backups` 复制到另一块磁盘。

### 主机的批准方式

已登录用户的扫码批准，以及从网页下载的客户端，无论批准方式如何，都会以该用户的账号批准主机。也就是说，任何拥有账号的人都能添加主机，所以只把账号交给你信任的人。其他主机由设置 (설정) 标签页中的批准方式决定：

- **管理员逐台批准。** 主机一直等待，直到管理员在设备 (기기) 标签页或通过 Telegram 通知中的批准按钮批准。
- **已登录的主机立即批准**（默认）。在配对请求中发送账号和密码的主机当场获得批准；密码只在这时检查。什么都没发送的主机仍需等待。
- **全部批准。** 所有请求连接的主机都会获得批准，无论是否登录。这等于完全放弃批准环节，所以只在只有你自己的主机能访问的服务器上使用。

### 家庭网络中的明文 HTTP

CookingFoil 本身使用明文 HTTP。通过 `http://` 连接时，主机配对时发送的密码、申请会话时的访问密钥以及会话令牌本身，都会以未加密的形式经过网络。同一网络中的其他人可以读取它们。会话令牌 12 小时后失效，并且绑定到主机的设备密钥，这能缩小损失，但无法阻止。只要网络不是你一个人在用，就请使用 HTTPS。直接下载令牌在明文 HTTP 下从不发放。

### 收回访问权限

- **主机：** 在设备 (기기) 标签页收回它的访问密钥（也可以重新签发）。用户也可以在 `/pair` 对自己批准的主机这样做。该主机的会话令牌会立即失效。
- **尚未使用的客户端下载：** 在设备 (기기) 标签页或 `/pair` 撤回。已经用过的下载就和其他主机一样处理。
- **账号：** 在用户 (사용자) 标签页停用或删除。该账号的会话令牌和下载令牌都会随之失效。修改密码也会结束它的会话。请同时在设备 (기기) 标签页撤销它批准过的主机。
- **自动化令牌：** 在设置 (설정) 标签页撤销。
- **一次性作废所有令牌：** 运行 `docker compose exec cookingfoil node -e 'import("./src/db/security-stores.js").then((s) => ["download-link", "user-session"].forEach((n) => s.deleteSecret(n)))'`，然后重新启动服务器。包括网页登录在内，所有会话令牌和下载令牌都会失效，主机会用访问密钥重新登录。
- **被锁定的地址：** 在日志 (로그) 标签页解锁。

### 内置的防护

- 密码以 scrypt 哈希保存。注册令牌和自动化令牌只显示一次，只保留它们的哈希。
- 登录失败达到 `COOK_AUTH_MAX_FAILURES` 次会锁定该地址，每个地址都有速率限制。多次输错管理员代码会锁定账号和地址。
- 已知的攻击路径、路径穿越、控制字符和过长的 URL 会在登录前被拒绝，并计入同一锁定次数，也可以通过 Telegram 通知你。
- 来自浏览器的写入请求和 WebSocket 连接，只接受来自服务器自身页面的。WebSocket 消息最大 4 KB。
- 管理员设置的外部服务地址不能指向私有网络，只有 `COOK_OUTBOUND_PRIVATE_HOSTS` 中列出的主机例外。
- 响应带有防护性请求头（`nosniff`、`DENY` 框架限制、不发送 referrer）。每一次拒绝都会连同原因记录在日志 (로그) 标签页和 `X-CookingFoil-Deny` 响应头中。每个响应都带有本服务器的随机 ID `X-CookingFoil-Server-Id`（从任何地址访问都相同），每次登录拒绝（401、403）都带有与日志行相同的原因码 `X-CookingFoil-Auth`，客户端据此决定下一步。例如 `no-access-key`、`access-key-wrong`、`device-not-approved`、`session-expired`、`session-revoked`、`enroll-used`、`enroll-limit`、`device-limit`、`rebind-no-proof`。
- 在管理页面上保存的密钥不会再次显示。网页上传在你开启之前一直关闭。

如需报告漏洞，请参阅 [SECURITY.md](./SECURITY.md#简体中文)。请不要公开提交 issue。

## API

除了配对、注册和 `/healthz` 以外，所有端点都需要已配对主机的密钥或会话令牌，或已登录的网页。Basic `Authorization` 头只在配对路由上有效；在其他地方它不认证任何东西，也没有端点会要求它。

| 端点 | |
|---|---|
| `GET /shop.json` | 给自动化用的扁平文件目录：`{ files: [...] }`，每个文件名都带 `[TITLEID][vN]` 标记。只有在管理页面创建的自动化令牌（`Authorization: Bearer cft_…`）可以读取 |
| `GET /api/shop/sections` | 给 CookingFoil 客户端和网页的分区列表 |
| `GET /api/shop/info` | 服务器版本、下载提示，以及客户端可以依赖的 `features` |
| `GET /api/activity` | 已登录用户可查看运行中和最近的任务。只有管理员可以通过管理 API 停止任务。 |
| `GET /api/title/:id?lang=`, `/api/title/:id/extras` | 单个条目的详情及其附加文件 |
| `GET /api/shop/icon/:id`, `/api/shop/banner/:id`, `/api/shop/screenshot/:id/:n` | 图片 |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/file?path=`, `/bundle`, `/archive`, `/forwarder` | 自制程序应用（单个 `.nro` 或整个 `switch/<app>/` 文件夹）及其 HOME 菜单快捷方式。在管理页面上关闭的应用不会列出 |
| `GET /api/patches?lang=`, `/api/patches/:id/download` | 补丁 |
| `GET /api/saves?lang=`, `/api/saves/:id/download` | 存档文件 |
| `GET /api/retro/systems`, `/api/retro/games`, `/api/retro/games/:id/rom`, `/bundle`, `/boxart`, `/bezel.png`, `/forwarder.nsp` | 复古游戏及其图片，在复古文件夹中有 ROM 时可用 |
| `GET /api/retro/base-pack/manifest`, `/api/retro/base-pack/bundle` | 你提供的 RetroArch 基础包 |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | 保存在 `data/client/` 中的 CookingFoil 客户端构建（放进该文件夹，或在管理页面的上传标签页以“客户端”上传）及其 HOME 菜单快捷方式。只有当构建旁边的 `cookingfoil.nro.sig.json` 与该构建的版本、大小和 sha256 一致时，`latest` 才会带上 `signature`（在构建处生成的 Ed25519 签名） |
| `POST /api/pair/request`, `GET /api/pair/status` | 二维码设备配对（仅在开启二维码设备连接时可用）。设备在请求时发送一个随机的 `pairSecret`（64 位十六进制），查询状态时用 `X-Pair-Secret` 发送同一个值；访问密钥只下发给发送该值的一方。批准方式为“已登录的主机立即批准”时，以 Basic 发送的账号和密码会当场批准这台主机。每个 JSON 响应都带有 `passwordOnly: true`，`/api/shop/info` 列出功能 `pair-password-only`：密码只用于配对 |
| `POST /api/pair/enroll` | 主机把下载的客户端中的注册令牌连同 `X-Device-Key` 一起发送，换取自己的访问密钥。以下载它的账号批准，下载后 1 小时内最多可用于 `COOK_ENROLL_PER_HOUR` 台主机（默认 5，手动批准时为 1 台），更多主机请用二维码批准。拒绝：401 并带 `X-CookingFoil-Enroll: limit`（`X-CookingFoil-Auth: enroll-limit`）、`used`、`expired`、`revoked` 或 `invalid`；账户的主机数已满时为 403 并带 `X-CookingFoil-Auth: device-limit` |
| `GET /api/session` | 用已配对主机的访问密钥换取 12 小时的会话令牌（忽略 Basic 头），之后以同一设备密钥只发送 `Authorization: Bearer cfs_…`。会话不能自行续期；批准该主机的账号修改密码、撤销设备、锁定都会立即使其失效。功能名为 `session-token` |
| `POST /api/pair/rebind` | 把同一台设备迁移到新的设备密钥（批准状态、名称和访问密钥）。供改为从主机生成设备密钥的客户端使用。用旧密钥的访问密钥，或以批准该设备的账户进行 Basic 认证来证明。功能名为 `device-rebind` |
| `GET /healthz` | 健康检查，供镜像的 `HEALTHCHECK` 使用 |

客户端在使用可选字段之前，应先读取 `/api/shop/info` 中的 `features`。管理 API（`/admin/api/*`）在 `/admin/guide` 的运维指南中有说明。

## 常见问题与故障排查

**主机无法连接。** 查看概览 (개요) 标签页上的警告和日志 (로그) 标签页上被拒绝的请求。每条拒绝都写明了原因。

**日志 (로그) 标签页上什么都没有，但主机说服务器没有响应。** 请求根本没有到达服务器。常见原因是路由器的 DNS 没有响应。把主机的 DNS 手动设为 `1.1.1.1`（备用 `8.8.8.8`）这样的公共解析器，或者修改路由器分发的 DNS。

**保存了密码的主机收到 401。** 主机持续访问时从不使用密码。请通过扫码或网页的“下载客户端”连接 CookingFoil 客户端。Tinfoil 和 CyberFoil 不受支持。

**在代理后面，所有客户端同时被锁定。** 没有设置 `COOK_TRUST_PROXY`，所有客户端共用了代理的地址。请参阅[反向代理与 HTTPS](#反向代理与-https)。

**我自己的地址被锁定了。** 在日志 (로그) 标签页上解锁。如果进不了管理页面，用 `COOK_RESET_LOCKOUTS=true` 启动一次，然后再删掉它。

**我丢失了身份验证器。** 如果设置过管理员密码，用它登录。如果两者都丢失了，在 `.env` 中写入 `COOK_ADMIN_PASSWORD`（12 个字符以上），重启后用它登录。

**名称显示成了文件名。** titledb 还在下载中，或者该标题不在 titledb 里。把你自己的 `prod.keys` 放进 `storage/keys/`，以便从文件中读取名称和图标，并查看概览 (개요) 标签页上的名称状态面板。

**复古游戏缺少封面。** 在复古 (레트로) 标签页上使用"获取缺失项 (빠진 것 모두 받기)"，或手动匹配游戏。GitHub 令牌（设置 (설정)）可以解除 GitHub 每小时 60 次请求的限制。

## 开发

需要 Node.js 20 或更新版本（镜像和 CI 使用 Node 22）。

```bash
npm install
cp .env.example .env
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
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

如今的 CookingFoil 是只为自己的客户端和网页服务的独立服务器，Tinfoil 和 CyberFoil 不是受支持的客户端。CookingFoil 客户端的安装引擎基于 [CyberFoil](https://github.com/luketanti/CyberFoil) 构建，本服务器提供的分区目录格式也源自 CyberFoil。感谢这两个项目。

本项目基于以下成果：

- [blawar/titledb](https://github.com/blawar/titledb)，提供标题名称、简介和图片地址，运行时获取。
- [nstool](https://github.com/jakcron/nstool)（MIT）和 [nsz](https://github.com/nicoboss/nsz)（MIT），打包在镜像中。
- [hacBrewPack](https://github.com/rlaphoenix/hacBrewPack/tree/745b16ecfc9ce055743067d200572204cb2aac6c)（GPL-2.0）和 [nx-hbloader](https://github.com/switchbrew/nx-hbloader)（ISC），用于 HOME 菜单快捷方式。
- [libretro-thumbnails](https://github.com/libretro-thumbnails) 的封面和 [The Bezel Project](https://github.com/thebezelproject) 的边框，运行时获取。
- [LaunchBox Games Database](https://gamesdb.launchbox-app.com/)、[IGDB](https://www.igdb.com/) 和 Steam，提供游戏详情和分数，运行时获取。
- [FinalBurn Neo](https://github.com/finalburnneo/FBNeo) 的套装列表，用于街机名称。
- [Lucide](https://lucide.dev) 图标（ISC），以及 Baloo 2 和 IBM Plex Sans KR 字体（SIL OFL 1.1）。

[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 列出了所有打包组件及其许可证。
