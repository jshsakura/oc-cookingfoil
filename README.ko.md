# CookingFoil

집에 있는 서버에 파일을 올려 두고, 기기의 홈브류 앱으로 받아 쓰는 개인용 파일 서버입니다.

Language: [English](README.md) | **한국어**

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

웹사이트: <https://jshsakura.github.io/oc-cookingfoil/>

## 개요

집 서버에 Docker 로 띄워 씁니다. 넣어 둔 파일의 이름과 아이콘을 찾아 붙이고, 그 목록을 CyberFoil, Tinfoil 방식 클라이언트, CookingFoil 클라이언트에 내려 줍니다.

소프트웨어, 키, BIOS 파일, RetroArch 는 들어 있지 않습니다. 그 폴더들은 비어 있는 채로 시작하고, 갖고 있는 파일을 직접 넣기 전까지 관련 기능은 꺼져 있습니다.

서버와 클라이언트는 따로 있는 프로젝트입니다.

| 프로젝트 | 실행 위치 | 배포물 |
|---|---|---|
| CookingFoil 서버 (이 저장소) | Docker 호스트 | `ghcr.io/jshsakura/oc-cookingfoil` |
| CookingFoil 클라이언트 | 기기의 홈브류 런처 | `cookingfoil.nro` (공개 전) |

## 빠른 시작

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
mkdir -p games data keys
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

`http://<host>:9080/` 을 열면 처음 설정 화면이 나옵니다. 로그에 찍힌 설정 코드를 넣고 관리자 계정을 만든 뒤 인증 앱을 등록합니다. 코드가 없으면 누구도 서버를 먼저 차지할 수 없고, 코드는 켤 때마다 바뀝니다. 클라이언트에도 같은 주소를 서버 주소로 넣습니다.

외부 서비스 키(IGDB 평점, SteamGridDB 표지, Dropbox 세이브 동기화, GitHub, 평점 서버)는 관리 페이지의 설정 탭에서 넣습니다. 키마다 어디서 발급하는지 안내가 있고, 넣지 않아도 서버는 동작합니다.

```
cookingfoil/
├── docker-compose.yml
├── .env              # 설정, 모두 선택
├── games/            # 내 파일 (필수)
├── data/             # 캐시, 계정, 설정. 처음 실행할 때 만들어집니다
└── keys/             # 선택, 읽기 전용
```

## 클라이언트 연결

- **CyberFoil:** 설정의 주소 칸에 서버 주소를, 아이디와 비밀번호 칸에 계정을 넣습니다. *기기* 페이지(`/pair`)에서 기기별 로그인을 만들어 쓰면 더 안전합니다. 목록 읽기만 되고, 처음 쓴 기기에 묶이며, 언제든 끊을 수 있습니다.
- **Tinfoil 방식 클라이언트:** *File Browser* 에서 `+` 를 누르고 `/shop.tfl` 로 끝나는 주소와 계정을 넣습니다.
- **CookingFoil 클라이언트:** `COOK_DEVICE_PAIRING=true` 이면 기기에 QR 이 뜹니다. 휴대폰으로 찍고 로그인해 승인하면 됩니다. 기기에는 비밀번호가 남지 않습니다.

## 설정

설정은 모두 `COOK_` 로 시작하는 환경 변수입니다. 전체 목록은 [`.env.example`](./.env.example) 에 있고, 자주 바꾸는 것은 아래와 같습니다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `COOK_AUTH_USERS` | _(비어 있음)_ | 미리 넣어 둘 계정. `user:pass,user2:pass2` 형식이고, 넣으면 `/setup` 대신 처음 한 번 가져옵니다 |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` 면 계정이 없어도 `/setup` 으로 보내지 않고 서버를 열어 둡니다 |
| `COOK_HOST_PORT` | `9080` | 호스트 포트 |
| `COOK_PUBLIC_BASE_URL` | _(비어 있음)_ | 리버스 프록시나 터널 뒤에 둘 때 바깥 주소 |
| `COOK_TRUST_PROXY` | _(비어 있음)_ | 믿을 프록시 범위. 예: `loopback, uniquelocal` |
| `COOK_ADMIN_PASSWORD` | _(비어 있음)_ | 관리 페이지 비밀번호(12자 이상). 인증 앱 코드로도 들어갈 수 있습니다 |
| `COOK_DEVICE_PAIRING` | `false` | CookingFoil 클라이언트의 QR 승인 |
| `COOK_EXTRACT_ICONS` | `missing` | 파일에서 이름과 아이콘 읽기: `missing`, `all`, `off` |
| `COOK_TITLEDB_AUTO_FETCH` | `true` | 공개 타이틀 목록 받기. 한 번 받아 두면 오프라인으로 돕니다 |

구글 로그인, 외부 서비스 키, 홈브류 저장소, 계정은 관리 페이지(`/admin`)에서 정합니다.

## API

| 엔드포인트 | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 형식 목록 |
| `GET /api/shop/sections` | CyberFoil 과 CookingFoil 클라이언트용 목록 |
| `GET /api/shop/info` | 서버 버전과 클라이언트가 기대도 되는 `features` |
| `GET /api/title/:id?lang=` | 항목 하나의 상세 |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | 이미지 |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/api/homebrew/:id/file?path=`, `/api/homebrew/:id/forwarder` | 홈브류 앱(`.nro` 하나 또는 `switch/<앱>/` 폴더 전체, 설치 위치는 `install_path`)과 홈 메뉴 바로가기 |
| `GET /api/patches`, `/api/saves` | 유저 패치와 세이브 파일 |
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
├── routes/         # HTTP 라우트, 로그인과 관리 페이지
├── security/       # 계정, 세션, 기기, 잠금
├── meta/           # 이름, 아이콘, 홈브류 추적
├── retro/          # 레트로 폴더와 바로가기
└── views/          # 웹 화면
site/               # GitHub Pages 사이트
test/unit, test/web # node --test 와 Playwright
```

## 라이선스

MIT, [LICENSE](./LICENSE) 를 봅니다. Vinicios Clarindo 의 [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat)(MIT)에서 출발했습니다. 타이틀 정보는 [blawar/titledb](https://github.com/blawar/titledb) 에서 받고, 이미지에 [nstool](https://github.com/jakcron/nstool) 과 [nsz](https://github.com/nicoboss/nsz) 가 들어 있습니다. 자세한 것은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 에 있습니다.
