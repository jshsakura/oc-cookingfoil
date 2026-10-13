# CookingFoil

집에 있는 서버에 파일을 올려 두고, 관리 페이지 하나로 모두 관리하며, 기기의 홈브류 앱으로 받아 쓰는 개인용 파일 서버입니다.

Language: [English](README.md) | **한국어**

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

웹사이트: <https://jshsakura.github.io/oc-cookingfoil/>

## 개요

집 서버에 Docker 로 띄워 씁니다. 넣어 둔 파일의 이름과 아이콘을 찾아 붙이고, 그 목록을 CyberFoil, Tinfoil 방식 클라이언트, CookingFoil 클라이언트에 내려 줍니다.

- **모든 것을 관리 페이지에서 합니다.** 설정, 계정, 기기, 업로드, 홈브류, 패치, 세이브, 이름을 브라우저에서 바꿉니다. 바꾸면 바로 적용되고, 서버를 다시 띄우거나 파일을 손으로 고칠 일이 없습니다.
- **아무것도 들어 있지 않습니다.** 소프트웨어, 키, BIOS 파일, RetroArch 는 들어 있지 않습니다. 그 폴더들은 비어 있는 채로 시작하고, 갖고 있는 파일을 넣기 전까지 관련 기능은 꺼져 있습니다.
- **처음부터 잠겨 있습니다.** 처음 설정은 서버 로그에 찍힌 코드가 있어야 할 수 있습니다. 기기는 QR 승인이나 그 기기 전용 접속 정보로 연결해서, 계정 비밀번호가 기기에 남지 않습니다.

| 프로젝트 | 실행 위치 | 배포물 |
|---|---|---|
| CookingFoil 서버 (이 저장소) | Docker 호스트 | `ghcr.io/jshsakura/oc-cookingfoil` |
| CookingFoil 클라이언트 | 기기의 홈브류 런처 | `cookingfoil.nro` (공개 전) |

## 빠른 시작

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

1. `http://<host>:9080/` 을 엽니다. 처음 설정 화면이 나옵니다.
2. 로그에 찍힌 설정 코드를 넣습니다. 코드는 켤 때마다 바뀌어서, 코드 없이는 누구도 서버를 먼저 차지할 수 없습니다.
3. 관리자 계정을 만들고 인증 앱을 등록합니다.
4. 관리 페이지가 열립니다. 나머지는 모두 거기서 합니다.

클라이언트에는 브라우저로 연 주소를 그대로 서버 주소로 넣습니다.

## 폴더

```
cookingfoil/
├── docker-compose.yml
├── .env              # 선택. 처음 켤 때의 기본값
├── games/            # 내 파일
├── data/             # 캐시, 계정, 관리 페이지에서 정한 설정 전부. 이 폴더는 백업해 둡니다
├── keys/             # 선택, 읽기 전용
├── retro/            # 기종별 레트로 롬
├── patches/          # 기본 타이틀 ID 별 패치와 homebrew/<앱>/
├── saves/            # 타이틀 ID 별 세이브와 homebrew/<앱>/
└── homebrew/         # .nro 앱과 앱 폴더
```

없는 폴더는 Docker 가 만듭니다. 전부 다른 곳에 두려면 `.env` 에 `COOK_ROOT=/경로` 를 넣습니다. 하나만 옮기려면 그 폴더의 경로를 따로 넣습니다. 예를 들어 `COOK_GAMES_PATH=/mnt/disk/games` 입니다. 나머지는 `COOK_DATA_PATH`, `COOK_KEYS_PATH`, `COOK_RETRO_PATH`, `COOK_PATCHES_PATH`, `COOK_SAVES_PATH`, `COOK_HOMEBREW_PATH` 입니다.

`retro/` 안에서는 기종마다 짧은 이름의 폴더 하나를 씁니다. `roms/`, `thumbnails/`, `bezels/` 모두 같은 이름이고, 예를 들면 `retro/roms/snes/` 입니다. 이름은 `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` 입니다. 표지와 베젤은 기종의 libretro 이름으로 받아 오며, 이 이름은 코드 안의 대응표일 뿐입니다. 필요하면 `retro/systems.json` 에서 기종의 `folder` 나 `libretro` 이름을 바꿉니다.

## 관리 페이지

`/admin` 을 엽니다. 로그인한 뒤 관리자 비밀번호나 인증 앱 코드를 한 번 더 묻습니다. 바꾼 것은 모두 `data/` 에 저장하고 바로 적용합니다.

| 탭 | 하는 일 |
|---|---|
| 개요 | 서버 상태, 경고, 게임 이름을 어디서 읽는지 |
| 사용자 | 계정과 역할, 승인을 기다리는 구글 계정 |
| 기기 | 기기 승인과 거절, 이름 바꾸기와 끊기, 기기 전용 접속 정보 만들기 |
| 설정 | **서버 동작**: QR 기기 연결과 승인 방식, 웹 업로드, 공개 주소, 접속 인사, 이름과 아이콘을 읽을 곳, 이름 언어 순서, 게임 정보 받기와 지역, 공식 스토어 가격, 인기순, 공식 이미지, 평점 모으기. 외부 서비스 키, 구글 로그인, 관리자 비밀번호, 인증 앱, 자동화 토큰도 여기서 정합니다 |
| 알림 | 승인 요청, 잠금, 위험한 접근을 텔레그램으로 알립니다 |
| 로그 | 잠긴 주소, 거절한 요청, 클라이언트 오류 기록 |
| 추천 | 클라이언트 홈 맨 위에 나오는 줄 |
| 라이브러리 | 게임 파일 찾기와 지우기. 패치와 세이브를 편집하고, 다른 게임으로 옮기고, 지웁니다. 패치의 필수 표시, 게임 이름과 소개, 추가 정보도 여기서 정합니다 |
| 업로드 | 게임, 레트로 롬, 패치, 세이브, 홈브류를 파일이나 폴더째 올립니다 |
| 홈브류 | GitHub 저장소 추가, 앱 켜기와 끄기, 빼기. 직접 넣은 앱을 저장소에 잇습니다 |
| 레트로 | 표지와 베젤, 표지 올리기, 보여 줄 이름, 롬 지우기 |

`.env` 의 값은 처음 켤 때의 기본값일 뿐입니다. 관리 페이지에서 바꾸면 그 값을 쓰고, "compose 값으로"를 누르면 `.env` 값으로 돌아갑니다.

`/admin/guide` 의 운영 안내에 일마다 하는 법이 있습니다. 관리 페이지가 쓰는 API 도 정리돼 있어서, 자동화 토큰을 받은 스크립트나 AI 도우미가 같은 일을 할 수 있습니다.

## 클라이언트 연결

- **CookingFoil 클라이언트:** 설정 → 서버 동작에서 QR 로 기기 연결을 켭니다. 기기에 QR 이 뜨면 휴대폰으로 찍고 로그인해 승인합니다. 기기에는 비밀번호가 남지 않습니다.
- **CyberFoil:** 설정의 주소 칸에 서버 주소를 넣습니다. 아이디와 비밀번호 칸에는 기기 탭에서 만든 기기 전용 접속 정보를 넣습니다. 목록 읽기만 되고, 처음 쓴 기기에 묶이며, 언제든 끊을 수 있습니다. 계정을 그대로 넣어도 됩니다.
- **Tinfoil 방식 클라이언트:** *File Browser* 에서 `+` 를 누르고 `/shop.tfl` 로 끝나는 주소와 계정을 넣습니다.

## 환경 변수

관리 페이지가 생기기 전에 정해야 하는 것만 여기 둡니다. 전체 목록은 [`.env.example`](./.env.example) 에 있습니다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | 호스트 포트 |
| `COOK_ROOT` | `.` | 위 폴더들을 만들 호스트 폴더 |
| `COOK_TRUST_PROXY` | _(비어 있음)_ | 믿을 프록시 범위. 예: `loopback, uniquelocal` |
| `COOK_AUTH_USERS` | _(비어 있음)_ | 미리 넣어 둘 계정. `user:pass,user2:pass2` 형식이고, `/setup` 대신 처음 한 번 가져옵니다 |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` 면 계정이 없어도 `/setup` 으로 보내지 않고 서버를 열어 둡니다 |
| `COOK_ADMIN_PASSWORD` | _(비어 있음)_ | 관리자 비밀번호와 인증 앱을 둘 다 잃었을 때 다시 들어가는 비밀번호(12자 이상) |

`COOK_DEVICE_PAIRING`, `COOK_PUBLIC_BASE_URL`, `COOK_EXTRACT_ICONS`, 서비스 키처럼 관리 페이지에서 바꾸는 설정도 여기서 미리 넣을 수 있습니다. 그 값은 기본값으로만 씁니다.

## API

| 엔드포인트 | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 형식 목록 |
| `GET /api/shop/sections` | CyberFoil 과 CookingFoil 클라이언트용 목록 |
| `GET /api/shop/info` | 서버 버전과 클라이언트가 기대도 되는 `features` |
| `GET /api/title/:id?lang=` | 항목 하나의 상세 |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | 이미지 |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/api/homebrew/:id/file?path=`, `/api/homebrew/:id/bundle`, `/api/homebrew/:id/forwarder` | 홈브류 앱(`.nro` 하나 또는 `switch/<앱>/` 폴더 전체, 설치 위치는 `install_path`)과 홈 메뉴 바로가기. 폴더 앱은 `bundle` 로 tar 하나에 담아 받을 수도 있습니다. 관리 페이지에서 끈 앱은 빠집니다 |
| `GET /api/patches?lang=`, `/api/saves?lang=` | 패치와 세이브 파일. `ko` 면 한국어 이름과 설명을 줍니다 |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro` | `data/client/` 에 둔 클라이언트 빌드 |
| `GET /api/retro/systems`, `/api/retro/games` | 레트로 폴더를 만들었을 때 그 안의 파일 |

클라이언트는 선택 필드를 쓰기 전에 `/api/shop/info` 의 `features` 를 확인합니다.

## 개발

```bash
npm install
cp .env.example .env
npm run dev             # http://localhost:3001
npm run lint
npm run test:unit
npm run test:web        # 먼저 npx playwright install chromium
```

```
src/
├── index.js        # 서버 진입점
├── routes/         # HTTP 라우트. admin/ 에 관리 페이지 탭마다의 API 와 화면
├── security/       # 계정, 세션, 기기, 잠금, 관리 페이지에서 정한 설정
├── meta/           # 이름, 아이콘, 패치, 세이브, 홈브류 추적
├── retro/          # 레트로 폴더, 이름, 바로가기
└── views/          # 웹 화면과 운영 안내
site/               # GitHub Pages 사이트
test/unit, test/web # node --test 와 Playwright
```

새 설정은 관리 페이지에 조작할 곳을 두고, `data/` 에 저장하고, 환경 변수는 기본값으로만 씁니다.

## 라이선스

MIT, [LICENSE](./LICENSE) 를 봅니다. Vinicios Clarindo 의 [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat)(MIT)에서 출발했습니다. 타이틀 정보는 [blawar/titledb](https://github.com/blawar/titledb) 에서 받고, 이미지에 [nstool](https://github.com/jakcron/nstool) 과 [nsz](https://github.com/nicoboss/nsz) 가 들어 있습니다. 자세한 것은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 에 있습니다.
