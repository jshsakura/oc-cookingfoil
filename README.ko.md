# CookingFoil

[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

스위치 홈브류를 위한 개인용 자체 호스팅 파일 서버이자 샵입니다. 파일은 집에 있는 서버에 두고, 관리 페이지 하나로 모두 관리하며, 기기의 홈브류 클라이언트(CookingFoil 클라이언트, CyberFoil, Tinfoil 호환 클라이언트)로 설치합니다.

웹사이트: <https://jshsakura.github.io/oc-cookingfoil/>

## 목차

- [개요](#개요)
- [기능](#기능)
- [빠른 시작](#빠른-시작)
- [폴더](#폴더)
- [설정](#설정)
- [관리 페이지](#관리-페이지)
- [클라이언트 연결](#클라이언트-연결)
- [리버스 프록시와 HTTPS](#리버스-프록시와-https)
- [직접 다운로드 주소](#직접-다운로드-주소)
- [보안 모델](#보안-모델)
- [API](#api)
- [자주 묻는 질문과 문제 해결](#자주-묻는-질문과-문제-해결)
- [개발](#개발)
- [법적 고지](#법적-고지)
- [라이선스와 감사의 말](#라이선스와-감사의-말)

## 개요

CookingFoil 은 직접 운영하는 서버에서 Docker 로 실행합니다. 넣어 둔 파일의 이름과 아이콘을 찾아 붙이고, 그 목록을 기기의 클라이언트에 내려 줍니다.

- **모든 것을 관리 페이지 하나에서 합니다.** 설정, 계정, 기기, 업로드, 홈브류, 패치, 세이브, 이름을 브라우저에서 바꿉니다. 바꾸면 바로 적용되고, 서버를 다시 켜거나 파일을 손으로 고칠 일이 없습니다.
- **아무것도 들어 있지 않습니다.** 게임, 키, 펌웨어, BIOS 파일, RetroArch 는 들어 있지 않습니다. 그 폴더들은 비어 있는 채로 시작하고, 합법적으로 가진 파일을 넣기 전까지 관련 기능은 꺼져 있습니다.
- **처음부터 잠겨 있습니다.** 처음 설정은 서버 로그에 찍힌 코드가 있어야 할 수 있습니다. 기기는 QR 승인이나 그 기기 전용 접속 정보로 연결하므로, 계정 비밀번호가 기기에 남지 않습니다.

| 프로젝트 | 실행 위치 | 배포물 |
|---|---|---|
| CookingFoil 서버 (이 저장소) | Docker 호스트 | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil 클라이언트 | 기기의 홈브류 메뉴 | [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) |

웹 화면, 처음 설정, 로그인, 기기 승인 페이지는 영어, 한국어, 일본어, 중국어 간체로 볼 수 있습니다. 관리 페이지와 운영 안내(`/admin/guide`)는 지금은 한국어로만 제공합니다.

## 기능

- **샵 목록과 섹션.** Tinfoil 형식 목록(`/shop.tfl`, `/shop.json`)과 CyberFoil, CookingFoil 클라이언트용 섹션 목록을 내려 줍니다. 위쪽 추천 줄은 관리 페이지에서 정합니다.
- **이름과 아이콘.** 제목, 소개, 그림은 [blawar/titledb](https://github.com/blawar/titledb) 에서 가져오고, titledb 에 없는 파일은 파일 자체에서 읽습니다(직접 가진 `prod.keys` 필요). 이름 언어 순서와 지역은 설정에서 고릅니다.
- **그림, 가격, 평점.** 아이콘, 배너, 스크린샷은 공개 스토어 그림 서비스에서 받아 디스크에 캐시합니다. 스토어 가격, 인기순, Steam 리뷰 점수, IGDB 점수는 선택입니다. 출처마다 끌 수 있고, 그림을 직접 올릴 수도 있습니다.
- **GitHub 홈브류.** 저장소를 추가하면 최신 릴리스(`.nro`, 또는 그것이 든 zip)를 따라갑니다. 앱을 직접 넣어 둘 수도 있습니다. 앱마다 홈 메뉴 바로가기를 함께 내려 줄 수 있습니다.
- **세이브와 패치.** 세이브 파일과 패치(SD 카드 루트와 같은 구조)를 서버에 보관하고, 클라이언트에서 넣을 것을 고릅니다.
- **RetroArch 용 레트로 게임.** 시스템별 롬, libretro-thumbnails 의 표지, The Bezel Project 의 베젤, LaunchBox Games Database 의 게임 정보(소개, 배급사, 개발사, 출시일, 인원, 장르, 스크린샷)를 다루고, 빠진 정보는 IGDB 로 채웁니다. 직접 준비한 RetroArch 기본 묶음을 기기에 내려 줄 수 있고, 게임마다 홈 메뉴 바로가기를 만들 수 있습니다.
- **QR 기기 연결.** CookingFoil 클라이언트가 QR 코드를 띄웁니다. 휴대폰으로 찍고 로그인해 승인합니다. 기기에는 비밀번호가 남지 않습니다.
- **계정과 구글 로그인.** 관리자와 일반 사용자 역할의 아이디·비밀번호 계정, 기기별 접속 정보, 선택 기능인 구글 로그인을 씁니다. 새 구글 계정은 승인을 기다립니다.
- **2단계 인증이 걸린 관리 페이지.** 관리 페이지는 인증 앱(TOTP) 코드나 별도의 관리자 비밀번호를 한 번 더 묻습니다. 자동화 토큰으로 스크립트가 같은 API 를 쓸 수 있습니다.
- **임시 공유.** 로그인한 사용자가 파일, 메모, 링크를 남기면 운영자가 나중에 정리합니다.
- **텔레그램 알림.** 기기·계정 승인 요청(승인, 거절 버튼 포함), 잠금, 막아 낸 공격 시도, 임시 공유 업로드, 서버 시작을 알립니다.
- **끊기지 않는 다운로드.** 다시 시작할 때 새 요청에는 `503` 과 `Retry-After` 로 답하고, 진행 중인 다운로드는 끝까지 마치게 합니다. 선택 기능인 직접 다운로드 주소는 다운로드만 실어 나르며, 로그인 대신 수명이 짧은 다운로드 토큰으로 엽니다.

## 빠른 시작

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

1. `http://<host>:9080/` 을 엽니다. 처음 설정 화면이 나옵니다.
2. 로그에 나온 설정 코드를 넣습니다. 코드는 켤 때마다 바뀌므로, 로그를 볼 수 없는 사람은 서버를 차지할 수 없습니다.
3. 관리자 계정을 만들고 인증 앱을 등록합니다.
4. 관리 페이지가 열립니다. 나머지는 모두 거기서 합니다.

클라이언트에는 브라우저로 연 주소를 그대로 넣습니다. 업데이트는 `docker compose pull && docker compose up -d` 로 합니다.

compose 파일을 줄이면 이렇습니다([전체 파일](./docker-compose.yml)에는 줄마다 설명이 있습니다).

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

## 폴더

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

없는 폴더는 Docker 가 만듭니다. 전부 다른 곳에 두려면 `.env` 에 `COOK_ROOT=/path/to/cookingfoil` 을 넣습니다. 하나만 옮기려면 그 폴더의 경로를 따로 넣습니다. 예를 들어 `COOK_GAMES_PATH=/path/to/games` 입니다. 나머지는 `COOK_DATA_PATH`, `COOK_KEYS_PATH`, `COOK_RETRO_PATH`, `COOK_PATCHES_PATH`, `COOK_SAVES_PATH`, `COOK_HOMEBREW_PATH` 입니다.

`retro/` 안은 이렇게 생겼습니다.

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

시스템마다 짧은 id 로 된 폴더가 하나 있습니다. `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` `neocd` 입니다. 아케이드 게임은 FinalBurn Neo 세트 이름(예: `mslug.zip`)을 그대로 씁니다. 표지는 파일 이름의 영어 제목으로 찾으므로 `내 제목 (English Title)` 같은 이름이 가장 잘 맞습니다.

RetroArch 기본 묶음은 기기가 게임을 하기 전에 한 번 받아야 하는 것들입니다. `retroarch.nro`, `retroarch.cfg` 와 RetroArch 가 쓰는 폴더(`cores/`, `assets/`, `system/` 등)를 `retro/retroarch/` 아래에 넣습니다. 게임이 있는 시스템에 어떤 BIOS 파일이 빠졌는지는 관리 페이지가 알려 줍니다. CookingFoil 은 BIOS 를 절대 포함하지 않습니다.

## 설정

대부분의 설정은 관리 페이지에서 바꾸고 바로 적용됩니다. `.env` 의 값은 처음 시작할 때의 기본값일 뿐입니다. 관리 페이지에서 설정을 바꾸면 그 값이 우선하고, "compose 값으로"를 누르면 `.env` 값으로 돌아갑니다. 모든 변수와 설명은 [`.env.example`](./.env.example) 에 있습니다.

아래는 관리 페이지가 생기기 전에 알아야 하거나, 일부러 관리 페이지에서 뺀 것입니다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | 호스트 포트 |
| `COOK_ROOT` | `.` | 위 폴더들을 만들 호스트 폴더 |
| `COOK_TRUST_PROXY` | _(비어 있음)_ | 클라이언트 주소를 정해도 되는 프록시 단계. 예: `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` 면 계정이 없는 서버를 `/setup` 으로 보내지 않고 열어 둡니다 |
| `COOK_AUTH_USERS` | _(비어 있음)_ | `/setup` 대신 미리 만들어 둘 계정. `user:pass,user2:pass2` |
| `COOK_ADMIN_PASSWORD` | _(비어 있음)_ | 관리자 비밀번호와 인증 앱을 모두 잃었을 때 다시 들어가는 방법(12자 이상) |
| `COOK_ADMIN_TOTP_SECRET` | _(비어 있음)_ | `/setup` 대신 인증 앱 시크릿을 직접 관리합니다 |
| `COOK_DIRECT_EDGE_SECRET` | _(비어 있음)_ | 직접 다운로드 프록시와 나누는 시크릿. [아래](#직접-다운로드-주소) 참고 |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_AUTH_MAX_FAILURES` | `1200`, `5` | 주소별 요청 한도와 잠기기 전까지 허용하는 로그인 실패 횟수 |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(비어 있음)_ | 사설, 루프백, CGNAT 주소로 풀려도 서버가 가져와도 되는 호스트 이름입니다. 예를 들어 tailnet 안의 평점 서버입니다. 관리 페이지에서 넣은 그 밖의 주소가 내부망을 가리키면 거절합니다 |

보통 관리 페이지(설정 탭)에서 바꾸는 것들입니다. 모두 `.env` 로 미리 정할 수도 있습니다.

| 설정 | 변수 | 기본값 |
|---|---|---|
| QR 기기 연결 | `COOK_DEVICE_PAIRING` | `false` |
| 기기 승인 방식 | `COOK_DEVICE_AUTO_APPROVE` | `true` (로그인한 기기는 승인) |
| 공개 주소 | `COOK_PUBLIC_BASE_URL` | 요청마다 알아냄 |
| 웹 업로드 | `COOK_UPLOADS_ENABLED` | `false` |
| 임시 공유 | `COOK_INBOX_ENABLED` | `true` |
| 이름 언어 순서 | `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` |
| titledb 받기, 지역, 출처 | `COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL` | 켜짐, 내장 목록, blawar/titledb |
| 파일에서 아이콘 읽기 | `COOK_EXTRACT_ICONS` | `missing` |
| 스토어 가격, 인기순, 그림 | `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` | 켜짐 |
| 리뷰 점수, 레트로 게임 정보 | `COOK_RATING_SYNC`, `COOK_RETRO_META` | 켜짐 |
| 다운로드당 연결 수 | `COOK_DOWNLOAD_MAX_CONNECTIONS` | `4` |
| 직접 다운로드 주소, 토큰 수명 | `COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL` | 꺼짐, `21600` 초 |
| 안전한 재시작 | `COOK_RESTART_RETRY_AFTER`, `COOK_RESTART_GRACE` | `20` 초, `25` 초 |

외부 서비스 키(IGDB, SteamGridDB, Dropbox, GitHub, 평점 서버), 구글 로그인, 텔레그램 알림은 관리 페이지에서 넣습니다. 각 키를 어디서 받는지도 거기 나옵니다. 모두 선택이며, 없으면 그 키가 필요한 기능만 꺼집니다.

## 관리 페이지

`/admin` 을 엽니다. 로그인한 뒤 인증 앱 코드나 관리자 비밀번호를 한 번 더 묻습니다(관리자 역할의 구글 계정으로 로그인했으면 묻지 않습니다). 바꾼 것은 모두 `data/` 아래에 저장되고 바로 적용됩니다.

| 탭 | 하는 일 |
|---|---|
| 개요 | 서버 상태, 설정 경고, 게임 이름을 어디서 가져오는지 |
| 사용자 | 계정과 역할, 승인을 기다리는 구글 계정 |
| 기기 | 기기 승인과 거절, 이름 바꾸기와 끊기, 기기 하나 전용 접속 정보 만들기 |
| 설정 | 서버 동작(기기 승인, 업로드, 공개 주소, 환영 메시지, 이름과 지역, 스토어 정보, 평점, 다운로드, 안전한 재시작), 외부 서비스 키, 구글 로그인, 관리자 비밀번호, 인증 앱, 자동화 토큰 |
| 알림 | 텔레그램 알림과 알릴 일 |
| 로그 | 잠긴 주소, 이유가 적힌 거절 기록, 클라이언트 오류 기록 |
| 추천 | 클라이언트 홈 화면 맨 위의 줄 |
| 라이브러리 | 파일 찾기와 지우기, 패치와 세이브 편집·이동·삭제, 필수 패치 표시, 게임 이름·소개·추가 정보 쓰기 |
| 업로드 | 게임, 레트로 롬, 패치, 세이브, 홈브류를 파일이나 폴더째 올리기 |
| 임시 공유 | 로그인한 사용자가 남긴 파일, 메모, 링크 |
| 홈브류 | GitHub 저장소 추가, 앱 켜기·끄기, 빼기, 직접 넣은 앱을 저장소와 잇기 |
| 레트로 | 표지와 베젤, 표지 올리기, 표시 이름, 변형판, 롬 지우기 |

`/admin/guide` 의 운영 안내에 작업마다 하는 법과 관리 페이지가 쓰는 API 가 정리돼 있습니다. 자동화 토큰을 가진 스크립트나 AI 도우미도 같은 일을 할 수 있습니다.

## 클라이언트 연결

**CookingFoil 클라이언트.** [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) 를 받아 SD 카드의 `switch/` 폴더에 넣고 홈브류 메뉴에서 엽니다. 서버 주소를 넣습니다. QR 기기 연결을 켜 두면(설정 탭의 서버 동작) 기기에 QR 코드가 뜹니다. 휴대폰으로 찍고 로그인해 승인합니다. 연결한 뒤에는 클라이언트가 서버에서 스스로 업데이트하고, 홈 메뉴 바로가기도 직접 만들 수 있습니다.

**CyberFoil 또는 Tinfoil 호환 클라이언트.** 서버를 샵으로 추가합니다.

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

집 안 네트워크에서는 서버의 내부 주소와 `http`, 포트 `9080` 을 써도 됩니다. 아이디와 비밀번호에는 기기 탭에서 만든 기기별 접속 정보를 쓰는 편이 안전합니다. 목록 읽기만 할 수 있고, 처음 쓴 기기에 묶이며, 언제든 끊을 수 있습니다. 내 계정을 써도 됩니다. Tinfoil 에서는 *File Browser* 에서 `+` 를 누르고 같은 칸을 채웁니다.

기본 Tinfoil 과 CyberFoil 은 QR 로 연결할 수 없습니다. 이 둘은 늘 계정이나 기기별 접속 정보로 로그인하며, QR 로 연결한 기기와 나란히 씁니다.

## 리버스 프록시와 HTTPS

CookingFoil 은 일반 HTTP 로 동작합니다. 집 밖에서 접속하려면 HTTPS 를 처리하는 리버스 프록시나 터널(nginx, Caddy, Traefik, Cloudflare Tunnel 등) 뒤에 둡니다.

그대로 쓸 수 있는 Caddy(HTTPS 를 한 스택으로), nginx, Cloudflare Tunnel 설정 파일은 [`examples/`](examples/) 에 있습니다.

- `COOK_TRUST_PROXY` 에는 클라이언트 주소를 정해도 되는 단계만 넣습니다. 같은 호스트나 내부망의 프록시라면 `loopback, uniquelocal` 입니다. `true` 는 모든 단계를 믿으므로, 프록시를 거치지 않고는 서버에 닿을 수 없을 때만 안전합니다. 이 설정이 없으면 모든 클라이언트가 프록시의 주소 하나로 보여서, 낯선 사람 한 명의 로그인 실패가 모두를 잠글 수 있습니다. 관리 페이지가 이 상황을 보면 경고합니다. `X-Forwarded-Host` 와 `X-Forwarded-Proto` 도 이 단계에서 온 것만 믿고, 그 밖에서 오면 연결 자체의 `Host`(설정했다면 `COOK_PUBLIC_BASE_URL`)를 씁니다.
- 프록시가 `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` 를 넘기게 합니다. 다운로드와 그림 주소는 절대 주소이고 이 헤더로 만듭니다. 프록시가 `Host` 를 바꾼다면 관리 페이지에서 공개 주소를 정합니다(또는 `COOK_PUBLIC_BASE_URL=https://shop.example.org`).
- 큰 응답과 오래 걸리는 요청을 허용합니다. 기기는 Range 요청을 여러 번 나눠 받고, 파일 하나가 수십 GB 일 수 있습니다.
- CookingFoil 앞에 둔 개발 서버(Vite 등)는 모르는 `Host` 헤더를 `403` 으로 거절할 수 있습니다. 프록시를 의심하기 전에 `curl -H "Host: shop.example.org" http://127.0.0.1:9080/` 로 원본을 직접 확인합니다.

## 직접 다운로드 주소

어떤 구성에서는 샵이 거치는 터널이나 CDN 이 아주 큰 파일에 느리거나 제한이 있습니다. 직접 다운로드 주소를 쓰면, 요청한 클라이언트는 다운로드만 실어 나르는 두 번째 HTTPS 주소에서 받고, 목록과 로그인은 원래 주소에 그대로 둡니다.

동작 방식은 이렇습니다.

1. 컨테이너와 같은 호스트의 리버스 프록시가 예를 들어 `https://dl.example.org` 를 맡습니다. 이 프록시는 `Authorization: Bearer …` 가 붙은 `GET`, `HEAD` 요청만 넘기고, `X-Forwarded-For` 를 직접 쓰며, `Host` 를 직접 다운로드 주소(포트가 있으면 포트까지)로 정하고, `X-CookingFoil-Edge: <secret>` 을 붙입니다. 원래 쓰는 터널로 들어온 요청은 넘기지 않아야 합니다.
2. 같은 시크릿을 `.env` 의 `COOK_DIRECT_EDGE_SECRET` 에 넣습니다. 이 값은 관리 페이지 설정이 아닙니다. 없으면 직접 다운로드 주소는 아무것도 내주지 않습니다.
3. 주소는 관리 페이지(설정 탭의 다운로드)나 `COOK_PUBLIC_DIRECT_BASE_URL` 에 넣습니다. 반드시 `https://` 여야 합니다.
4. HTTPS 로 `X-CookingFoil-Features: direct-token` 을 보내는 로그인한 클라이언트는 `X-CookingFoil-Download-Token` 헤더를 받고, 목록의 다운로드 주소가 직접 다운로드 주소를 가리킵니다. 함께 오는 `X-CookingFoil-Download-Origin` 은 직접 다운로드 주소의 origin 이고, 클라이언트는 그곳에만 토큰을 Bearer 토큰으로 보냅니다.

토큰은 서버가 서명하고(`data/security/` 의 무작위 키로 HMAC-SHA256), `COOK_DOWNLOAD_LINK_TTL` 초(기본 6시간) 동안 유효하며, 토큰을 받은 계정이나 기기가 더는 로그인할 수 없게 되면 바로 쓸 수 없습니다. 거절에는 `X-CookingFoil-Token: invalid | expired | revoked | blocked` 가 붙고, 틀린 토큰을 너무 많이 보낸 주소는 한동안 막힙니다. 이 기능을 알리지 않는 클라이언트(Tinfoil, CyberFoil, 브라우저)와 일반 HTTP 요청은 전과 똑같은 목록을 봅니다. Cloudflare 를 거쳐 온 요청의 `CF-IPCountry` 가 `src/security/download-links.js` 에 정해 둔 나라가 아니면 원래 주소를 그대로 받습니다.

DNS 인증서와 DDNS 까지 갖춘 Caddy 설정 전체는 [`examples/direct-download/`](examples/direct-download/) 에 있습니다.

가장 작은 nginx 예시입니다(인증서, 포트, 시크릿은 맞게 고칩니다).

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

## 보안 모델

- **처음 설정은 로그의 코드로 차지합니다.** 관리자가 생기기 전까지 `/setup` 은 시작할 때 찍히는 코드를 요구하고, 코드는 켤 때마다 바뀝니다.
- **비밀번호**는 scrypt 해시로 저장합니다. 여러 번 틀리면 그 주소를 잠그고(`COOK_AUTH_MAX_FAILURES`, `COOK_LOCKOUT_TTL_HOURS`), 주소마다 요청 한도가 있습니다.
- **관리 페이지**는 로그인 위에 2단계 인증(TOTP 코드나 별도의 관리자 비밀번호)을 요구합니다. 코드를 여러 번 틀리면 계정과 주소를 잠급니다.
- **기기**는 승인 뒤 발급되는 기기 키와 접근 키로 연결하거나, 목록 읽기만 하고 기기 하나에 묶이는 기기별 접속 정보로 연결합니다. 승인은 직접 승인, 로그인한 기기 자동 승인, 모두 자동 승인 가운데 고릅니다.
- **자동화 토큰**은 만든 관리자 계정으로 `/admin/api/` 아래에서만 동작하고, 계정, 로그인 방식, 토큰은 바꿀 수 없습니다.
- **다운로드 토큰**(직접 다운로드 주소용)은 수명이 짧고, 서명되어 있고, 계정과 기기에 묶여 있으며, 엣지 시크릿을 가진 로컬 프록시에서 온 것만 받습니다.
- **시크릿**은 관리 페이지에 저장한 뒤 다시 보여 주지 않습니다. 키와 토큰은 `data/` 아래에 있으니 그 폴더를 보호하고 백업합니다.
- 응답에는 방어용 헤더(`nosniff`, `DENY` 프레임 차단, 리퍼러 없음)가 붙고, 알려진 공격 경로는 로그인 전에 거절합니다.

취약점 제보는 [SECURITY.md](./SECURITY.md) 를 봅니다.

## API

기기 연결과 `/healthz` 를 빼면 모든 엔드포인트는 샵과 같은 로그인(계정, 기기별 접속 정보, 연결한 기기) 뒤에 있습니다.

| 엔드포인트 | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 형식 목록 |
| `GET /api/shop/sections` | CyberFoil 과 CookingFoil 클라이언트용 섹션 목록 |
| `GET /api/shop/info` | 서버 버전, 다운로드 힌트, 클라이언트가 믿고 쓸 수 있는 `features` |
| `GET /api/title/:id?lang=`, `/api/title/:id/extras` | 항목 하나의 자세한 정보와 추가 파일 |
| `GET /api/shop/icon/:id`, `/api/shop/banner/:id`, `/api/shop/screenshot/:id/:n` | 그림 |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/file?path=`, `/bundle`, `/archive`, `/forwarder` | 홈브류 앱(`.nro` 하나 또는 `switch/<app>/` 폴더 전체)과 홈 메뉴 바로가기. 관리 페이지에서 끈 앱은 빠집니다 |
| `GET /api/patches?lang=`, `/api/patches/:id/download` | 패치 |
| `GET /api/saves?lang=`, `/api/saves/:id/download` | 세이브 파일 |
| `GET /api/retro/systems`, `/api/retro/games`, `/api/retro/games/:id/rom`, `/bundle`, `/boxart`, `/bezel.png`, `/forwarder.nsp` | 레트로 폴더에 롬이 있을 때 레트로 게임과 그림 |
| `GET /api/retro/base-pack/manifest`, `/api/retro/base-pack/bundle` | 직접 준비한 RetroArch 기본 묶음 |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | `data/client/` 에 둔 CookingFoil 클라이언트 빌드와 그 홈 메뉴 바로가기 |
| `POST /api/pair/request`, `GET /api/pair/status` | QR 기기 연결(QR 기기 연결이 켜져 있을 때만). 기기는 요청할 때 임의의 `pairSecret`(16진수 64자)을 보내고 상태를 물을 때 같은 값을 `X-Pair-Secret` 로 보냅니다. 접근 키는 그 값을 보낸 쪽에만 내려갑니다 |
| `GET /api/session` | 콘솔의 비밀번호(QR 로 연결한 기기는 접근 키)를 12시간짜리 세션 토큰으로 바꿉니다. 이후에는 같은 기기 키로 `Authorization: Bearer cfs_…` 만 보냅니다. 세션으로 세션을 다시 받을 수는 없고, 비밀번호 변경, 로그인이나 기기 회수, 잠금이 생기면 바로 끝납니다. 기능 이름은 `session-token` 입니다 |
| `POST /api/pair/rebind` | 같은 기기를 새 기기 키로 옮깁니다(승인, 이름, 접근 키, 기기별 로그인의 기기 고정). 기기 키를 본체에서 만들어 내게 된 클라이언트가 씁니다. 옛 키의 접근 키, 또는 그 기기를 승인한 계정이나 그 기기에 고정된 기기별 로그인의 Basic 인증으로 증명합니다. 기능 이름은 `device-rebind` 입니다 |
| `GET /healthz` | 상태 확인. 이미지의 `HEALTHCHECK` 가 씁니다 |

클라이언트는 선택 필드를 쓰기 전에 `/api/shop/info` 의 `features` 를 먼저 읽습니다. 관리 API(`/admin/api/*`)는 `/admin/guide` 의 운영 안내에 정리돼 있습니다.

## 자주 묻는 질문과 문제 해결

**기기가 접속하지 못합니다.** 개요 탭의 경고와 로그 탭의 거절 기록을 봅니다. 거절마다 이유가 적혀 있습니다.

**로그 탭에는 아무것도 없는데 기기는 서버가 응답하지 않는다고 합니다.** 요청이 서버까지 오지도 못한 것입니다. 공유기 DNS 가 응답하지 않는 경우가 많습니다. 기기의 DNS 를 `1.1.1.1`(보조 `8.8.8.8`) 같은 공개 DNS 로 직접 바꾸거나, 공유기가 나눠 주는 DNS 를 바꿉니다.

**프록시 뒤에서 모든 클라이언트가 한꺼번에 잠깁니다.** `COOK_TRUST_PROXY` 가 없어서 모든 클라이언트가 프록시 주소 하나를 같이 쓰는 것입니다. [리버스 프록시와 HTTPS](#리버스-프록시와-https) 를 봅니다.

**내 주소가 잠겼습니다.** 로그 탭에서 풉니다. 관리 페이지에 들어갈 수 없다면 `COOK_RESET_LOCKOUTS=true` 로 한 번 켰다가 다시 지웁니다.

**인증 앱을 잃었습니다.** 관리자 비밀번호를 정해 두었다면 그것으로 들어갑니다. 둘 다 잃었다면 `.env` 에 `COOK_ADMIN_PASSWORD`(12자 이상)를 넣고 다시 켠 뒤 그 비밀번호로 들어갑니다.

**이름이 파일 이름으로 나옵니다.** titledb 를 아직 받는 중이거나 titledb 에 없는 타이틀입니다. 직접 가진 `prod.keys` 를 `keys/` 에 넣으면 파일에서 이름과 아이콘을 읽습니다. 개요 탭의 이름 상태 패널도 확인합니다.

**CyberFoil 에 설치할 수 없는 줄이 보입니다.** `COOK_EMIT_TITLEDB` 를 꺼 둡니다. 이 설정은 기본 Tinfoil 전용입니다.

**레트로 게임에 표지가 없습니다.** 레트로 탭에서 "빠진 것 모두 받기"를 누르거나 직접 맞춥니다. GitHub 토큰(설정 탭)을 넣으면 시간당 60회인 GitHub 한도가 풀립니다.

## 개발

Node.js 20 이상이 필요합니다(이미지와 CI 는 Node 22 를 씁니다).

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

작업 흐름, 커밋 방식, 네 언어 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md) 에 있습니다.

## 법적 고지

CookingFoil 은 독립된 오픈소스 프로젝트입니다. Nintendo 나 다른 플랫폼 보유자와 관계가 없고, 그들의 보증이나 후원을 받지 않습니다. 여기 쓰인 이름은 식별을 위한 것입니다.

게임, 키, 펌웨어, BIOS 파일, RetroArch 등 저작권이 있는 콘텐츠는 들어 있지 않습니다. 파일은 직접 준비하며, 그 파일을 쓸 권리가 있는지는 사용자가 책임집니다. 예를 들어 가진 게임의 백업, 내 기기에서 직접 추출한 키 같은 것입니다. 권리가 없는 사람에게 콘텐츠를 나누는 데 CookingFoil 을 쓰지 마십시오.

## 라이선스와 감사의 말

MIT 라이선스입니다. [LICENSE](./LICENSE) 를 봅니다. CookingFoil 은 Vinicios Clarindo 의 [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat)(MIT)을 포크해 시작했습니다.

다음 프로젝트에 기대고 있습니다.

- [blawar/titledb](https://github.com/blawar/titledb): 타이틀 이름, 소개, 그림 주소. 실행 중에 받아 옵니다.
- [CyberFoil](https://github.com/luketanti/CyberFoil) 과 Tinfoil: 서버가 따르는 샵 형식.
- [nstool](https://github.com/jakcron/nstool)(MIT), [nsz](https://github.com/nicoboss/nsz)(MIT): 이미지에 들어 있습니다.
- [hacBrewPack](https://github.com/The-4n/hacBrewPack)(GPL-2.0), [nx-hbloader](https://github.com/switchbrew/nx-hbloader)(ISC): 홈 메뉴 바로가기.
- [libretro-thumbnails](https://github.com/libretro-thumbnails) 의 표지와 [The Bezel Project](https://github.com/thebezelproject) 의 베젤. 실행 중에 받아 옵니다.
- [LaunchBox Games Database](https://gamesdb.launchbox-app.com/), [IGDB](https://www.igdb.com/), Steam: 게임 정보와 점수. 실행 중에 받아 옵니다.
- [FinalBurn Neo](https://github.com/finalburnneo/FBNeo) 세트 목록: 아케이드 이름.
- [Lucide](https://lucide.dev) 아이콘(ISC), Baloo 2 와 IBM Plex Sans KR 글꼴(SIL OFL 1.1).

포함된 모든 구성 요소와 라이선스는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 에 있습니다.
