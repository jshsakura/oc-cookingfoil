<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/wordmark-dark.png">
    <img src="brand/wordmark-light.png" alt="cookingfoil." width="360">
  </picture>
</p>

<p align="center">
  닌텐도 스위치 홈브루 설치 앱을 위한 자체 호스팅 샵 서버입니다.<br>
  <b>CyberFoil</b> 을 기본으로 지원하고 Tinfoil 과도 호환되며, 내 파일에서 메타데이터를 만들어 냅니다.
</p>

<p align="center"><a href="./README.md">English</a></p>

<p align="center">
  <img src="docs/screenshots/preview-dark.png" alt="대시보드의 미리보기 탭: CookingFoil 클라이언트와 같은 배너와 스토어 줄" width="900">
</p>

> [!IMPORTANT]
> CookingFoil 은 비공식 프로젝트이며 닌텐도와 관련이 없고 승인이나 후원을 받지 않습니다. **게임, 키, 닌텐도 콘텐츠를 일절 포함하지 않습니다.** 내가 소유하고 내 기기에서 직접 덤프한 소프트웨어만 제공하고, `prod.keys` 는 공유하지 마세요. "Nintendo Switch" 와 "Nintendo eShop" 은 닌텐도의 상표입니다.

## 하는 일

`.nsp` / `.nsz` / `.xci` / `.xcz` 파일이 있는 폴더를 지정하면 스위치가 네트워크로 둘러보고 설치합니다.

- **CyberFoil 기본 지원.** CyberFoil 의 섹션 API(`/api/shop/sections`)로 이름·아이콘·버전·크기·필요 펌웨어를 주고, 휴대폰으로 QR 을 찍어 기기를 승인하는 페어링을 지원합니다.
- **Tinfoil 호환.** `shop.tfl` / `shop.json` 이 Tinfoil 계열 앱에서 동작합니다. [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat) 을 그대로 갈아 끼울 수 있습니다.
- **손대지 않아도 붙는 메타데이터.** [blawar/titledb](https://github.com/blawar/titledb) 를 지역별로 합치고, titledb 에 없는 게임은 게임 파일에서 이름과 아이콘을 직접 읽습니다(`prod.keys` 필요). 이름·설명·포스터를 한국어·영어·일본어·중국어로 줍니다.
- **리뷰 점수.** 게임마다 Steam(선택으로 IGDB) 점수를 이름으로 찾아 붙이고 매주 갱신합니다. 이름이 거의 같은 경우만 받습니다.
- **eShop 정보.** 인기 순위, 가격과 할인, eShop 아트. 각각 끌 수 있습니다.
- **웹 대시보드.** 4개 언어로 라이브러리를 보고, 클라이언트 스토어가 어떻게 보일지 미리 봅니다.
- **관리 페이지.** 사용자, 기기, 잠금과 거부 기록, 추천 줄, 다시 스캔. 인증 앱 코드나 관리자 비밀번호로 들어갑니다.
- **유저 패치.** 직접 모은 모드와 치트를 [CookingFoil 클라이언트](https://github.com/jshsakura/oc-cookingfoil-client)가 SD 카드에 설치하고 켜고 끌 수 있게 내려 줍니다.

## 둘러보기

| 모든 게임 | 게임 상세 | 휴대폰 (한국어) |
|---|---|---|
| <img src="docs/screenshots/games-light.png" alt="통계, 장르와 Steam 필터가 있는 모든 게임 탭" width="320"> | <img src="docs/screenshots/detail-light.png" alt="정보, 리뷰 점수, 스크린샷이 있는 게임 상세" width="320"> | <img src="docs/screenshots/preview-ko-phone.png" alt="휴대폰에서 본 한국어 미리보기 탭" width="150"> |

스크린샷은 가상의 게임과 생성한 자리표시 아트로 찍었습니다(`node scripts/readme-screenshots.mjs` 로 다시 만듭니다).

## 함께 쓰는 클라이언트

| 클라이언트 | 연결 방식 | 받는 것 |
|---|---|---|
| [CyberFoil](https://github.com/luketanti/CyberFoil) | 네이티브 섹션 API | 이름, 아이콘, 버전, 필요 펌웨어, QR 기기 페어링 |
| [CookingFoil 클라이언트](https://github.com/jshsakura/oc-cookingfoil-client) | 네이티브 API + `/api/title` | 스토어형 홈, 언어별 이름과 아트, 리뷰 점수, 유저 패치 |
| Tinfoil 계열 | `shop.tfl` | 이름과 아이콘이 있는 기존 파일 목록 |

## 빠르게 시작하기 (Docker)

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example

mkdir -p games data keys
# ./games 에 게임 파일을, 원하면 ./keys 에 prod.keys 를 넣습니다
# .env 에서 최소한 COOK_AUTH_USERS=아이디:긴비밀번호 를 정합니다

docker compose up -d
```

대시보드는 `http://<호스트>:9080/` 입니다. 클라이언트에 넣을 샵 주소도 `http://<호스트>:9080/` 이고, Tinfoil 은 `http://<호스트>:9080/shop.tfl` 입니다.

이미지는 `ghcr.io/jshsakura/oc-cookingfoil:latest` 이고 릴리스마다 빌드됩니다.

**만든 사람이 쓰는 그대로 운영하려면**(리버스 프록시나 터널, 관리 페이지, 평점, 패치) [`deploy/`](./deploy/README.md) 의 설정을 그대로 가져가세요. 항목마다 설명이 달려 있습니다.

## 클라이언트 연결

- **CyberFoil:** 설정의 *eShop URL* 에 샵 주소를 넣습니다. 계정을 쓰면 *eShop 사용자 이름 / 비밀번호* 도 채웁니다. `COOK_DEVICE_PAIRING=true` 면 대신 화면의 QR 을 휴대폰으로 승인할 수 있습니다.
- **Tinfoil 계열:** *File Browser* → `+` → `/shop.tfl` 로 끝나는 주소와 아이디·비밀번호.
- **CookingFoil 클라이언트:** `sdmc:/switch/cookingfoil/config.json` 에 `config.json` 을 둡니다. 관리 페이지에서 사용자를 만들 때 함께 보여 주고, 로그인한 브라우저에서 `/api/client-config` 로도 받습니다(비밀번호와 키는 넣지 않습니다).

## 설정

모든 설정은 `COOK_` 로 시작하는 환경 변수입니다. 전체 목록과 설명은 [`.env.example`](./.env.example) 에 있고, 자주 만지는 것은 아래와 같습니다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `COOK_AUTH_USERS` | _(비어 있음)_ | `user:pass,user2:pass2`. 처음 한 번 가져오고 그 뒤로는 `/admin` 에서 관리합니다 |
| `COOK_HOST_PORT` | `9080` | docker-compose 가 여는 호스트 포트 |
| `COOK_TRUST_PROXY` | _(비어 있음)_ | 믿을 프록시 단계. 예: `loopback, uniquelocal`. 프록시 뒤 클라이언트마다 잠금이 따로 걸립니다 |
| `COOK_ADMIN_PASSWORD` | _(비어 있음)_ | 인증 앱 대신 쓰는 관리자 비밀번호(12자 이상) |
| `COOK_DEVICE_PAIRING` | `false` | CyberFoil 기기를 QR 로 승인 |
| `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` | titledb 를 합칠 때 이름과 설명이 이기는 언어 순서 |
| `COOK_TITLEDB_REGIONS` | `KR.ko,US.en,JP.ja,EU.en,HK.zh` | 받아 올 titledb 지역 파일 |
| `COOK_RATING_SYNC` | `true` | Steam 리뷰 점수. IGDB 는 `COOK_IGDB_CLIENT_ID` / `_SECRET` 추가 |
| `COOK_ESHOP_PRICES` / `_POPULARITY` / `_ARTWORK` | `true` | 닌텐도 eShop 정보(아래 참고) |
| `COOK_EXTRACT_ICONS` | `missing` | 게임 파일에서 이름·아이콘 읽기: `missing`, `all`, `off` |

### 외부로 나가는 연결

titledb 를 한 번 받아 두면 오프라인으로도 잘 동작합니다. 허용하면 아래에 접속합니다.

| 서비스 | 이유 | 끄기 |
|---|---|---|
| `raw.githubusercontent.com` (blawar/titledb) | 게임 이름, 설명, 아트 주소 | `COOK_TITLEDB_AUTO_FETCH=false` |
| 닌텐도 eShop CDN | 아이콘, 배너, 스크린샷(디스크에 캐시) | `COOK_ESHOP_ARTWORK=false` |
| `api.ec.nintendo.com` | 가격과 할인 | `COOK_ESHOP_PRICES=false` |
| nintendo.com 의 공개 Algolia 색인 | 인기 순위 | `COOK_ESHOP_POPULARITY=false` |
| Steam 상점, IGDB | 리뷰 점수 | `COOK_RATING_SYNC=false` |

## 클라이언트용 API

| 엔드포인트 | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil 형식 목록 |
| `GET /api/shop/sections` | CyberFoil 과 CookingFoil 클라이언트용 목록(ETag) |
| `GET /api/shop/info` | 서버 버전과 클라이언트가 기대도 되는 `features` |
| `GET /api/title/:id?lang=` | 상세: 설명, 스크린샷, 업데이트, 가격, 점수, 언어별 이름과 아트 |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | 아트. `?size=sm\|md`, `?lang=` |
| `GET /api/patches`, `/api/patches/:id/download` | 유저 패치 목록과 ustar 묶음 |

선택 필드를 쓰기 전에 `/api/shop/info` 의 `features` 를 확인하세요.

## 개발

```bash
npm install
npm run hooks:install   # 선택: 커밋 전 검사(비밀값 차단, 문법, 부팅 시험)
cp .env.example .env
npm run dev             # http://localhost:3001

npm run lint
npm run test:unit       # node --test
npm run test:web        # Playwright, 먼저 npx playwright install chromium
```

PR 은 CI(lint, 단위, 웹)를 거칩니다. [CONTRIBUTING.md](./CONTRIBUTING.md) 와 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 를 보세요. 보안 문제는 [SECURITY.md](./SECURITY.md) 대로 비공개로 알려 주세요.

## 크레딧과 라이선스

MIT, [LICENSE](./LICENSE) 참고. Vinicios Clarindo 의 [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat)(MIT)에서 출발했습니다. 게임 메타데이터는 [blawar/titledb](https://github.com/blawar/titledb) 에서 오고, Docker 이미지에는 [nstool](https://github.com/jakcron/nstool) 과 [nsz](https://github.com/nicoboss/nsz) 가 들어 있습니다. 전체 목록은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 에 있습니다.
