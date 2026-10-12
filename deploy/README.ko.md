# 만든 사람처럼 cookingfoil 운영하기

[English](./README.md)

이 폴더는 그대로 돌아가는 전체 설정입니다. 컨테이너 하나, 파일 폴더, 계정,
관리 페이지, 리뷰 점수, 유저 패치까지 들어 있습니다. 복사하고 `.env` 를 채운 뒤
시작하면 됩니다.

## 1. 폴더

```
cookingfoil/
├── docker-compose.yml   (이 폴더의 것)
├── .env                 (.env.example 에서 복사)
├── data/                캐시, 메타데이터, 계정. 백업하세요
├── keys/prod.keys       선택, 내 기기에서 뽑은 것
└── patches/             선택, 유저 패치
```

파일은 어디에 있어도 되고 `GAMES_DIR` 로 그 폴더를 지정합니다. 하위 폴더와
아무 파일 이름이나 되지만 `이름 [TITLEID][v버전].nsp` 형식이 가장 잘 읽힙니다.

## 2. 설정

```bash
cp .env.example .env
openssl rand -base64 24        # 출력을 비밀번호로 씁니다
```

`.env` 에서 `GAMES_DIR` 과 `COOK_AUTH_USERS=아이디:<그 비밀번호>` 를 정합니다.
나머지는 기본값이 있고 `docker-compose.yml` 에 설명이 있습니다.

## 3. 시작과 확인

```bash
docker compose up -d
docker compose logs -f         # 처음엔 titledb 를 받습니다(몇 분)
curl http://localhost:38000/healthz
```

`http://<호스트>:38000/` 을 열고 계정으로 로그인합니다. 대시보드에 서버 주소와
이름이 titledb·파일 내용·파일 이름 중 어디서 오는지, 무엇이 빠졌는지가 나옵니다.

## 4. 기기 연결

- **CyberFoil:** 설정의 *eShop URL* = `http://<호스트>:38000/` 과 아이디·비밀번호. 계정을
  나눠 쓰기보다 *기기 승인*(`/pair`) 화면에서 기기마다 접속 정보를 만들어 넣습니다. 서버 읽기만
  되고 언제든 폐기할 수 있습니다.
- **Tinfoil 계열:** *File Browser* → `+` → `http://<호스트>:38000/shop.tfl`.
- **CookingFoil 클라이언트:** `COOK_DEVICE_PAIRING=true` 면 휴대폰으로 서버에 로그인해
  *기기 승인*(`/pair`) 화면에서 기기 화면의 QR 을 찍거나 기기 코드를 입력합니다. 기기에는
  비밀번호를 넣지 않습니다. 또는 관리 페이지에서 사용자를 만들면 보여 주는
  `config.json` 을 `sdmc:/switch/cookingfoil/config.json` 에 둡니다.

## 5. 관리 페이지

`/admin` 을 엽니다. `COOK_ADMIN_PASSWORD` 가 없으면 **같은 네트워크에서** 처음
들어갈 때 인증 앱용 설정 키가 나오고, 첫 코드가 맞으면 다시는 나오지 않습니다.
`COOK_ADMIN_PASSWORD` 를 두면 대신 그 비밀번호를 묻습니다(밖에서만 들어갈 때
편합니다). 2단계를 더하려면 관리 페이지의 *보안* 탭에서 인증 앱을 등록합니다.
그다음부터는 비밀번호 다음에 코드도 묻습니다.

여기서 계정 추가·삭제, 기기 승인, 잠금 해제, 클라이언트 홈 추천 줄, 다시 스캔을
합니다.

## 6. 밖에서 접속하기

리버스 프록시(Caddy, nginx, Traefik)나 터널(Cloudflare Tunnel, Tailscale)로 HTTPS
뒤에 둡니다. 프록시가 같은 호스트에 있으면 `COOK_TRUST_PROXY` 를
`loopback, uniquelocal` 로 두어야 비밀번호를 틀린 그 기기만 잠기고 프록시 뒤
전원이 함께 잠기지 않습니다.

기기의 앱은 Cloudflare Access 같은 브라우저 로그인 화면을 통과하지 못하므로,
서버 주소에는 서버 자체 계정(과 기기 페어링)을 쓰세요.

## 7. 선택 기능

- **prod.keys:** 내 기기의 `prod.keys` 를 `keys/` 에 넣으면 titledb 에 없는
  파일도 파일 안에서 실제 이름과 아이콘을 읽습니다.
- **리뷰 점수:** 기본으로 켜져 있습니다(Steam). IGDB 점수도 원하면 dev.twitch.tv
  에서 앱을 만들고 `COOK_IGDB_CLIENT_ID` / `COOK_IGDB_CLIENT_SECRET` 을 넣습니다.
- **유저 패치:** `patches/<본편 TITLE ID>/<패치 이름>/atmosphere/contents/<TITLE ID>/romfs/…`
  (또는 `romfs/`, `exefs/`, `atmosphere/exefs_patches/<이름>/`,
  `SaltySD/plugins/FPSLocker/patches/<TITLE ID>/`) 와 선택 `patch.json`
  (`name`, `version`, `game_version`, `author`, `description`). 이 경로 밖의 파일이
  하나라도 있으면 그 패치는 건너뜁니다.
- **홈브류(CookingFoil 클라이언트):** 관리 페이지의 *홈브류* 탭에서 GitHub 저장소를 추가합니다(추천 목록에서
  고르거나 주소를 붙여 넣습니다). 목록은 `data/homebrew/sources.json` 에 두고, `COOK_HOMEBREW_REPOS=owner/name,…`
  는 처음 시작할 때 목록을 채우는 데만 씁니다. 릴리스에는 `.nro` 나 `.nro` 가 든 `.zip` 이 있으면 되고, 파일이
  여럿이면 그 탭에서 쓸 것을 고릅니다. 저장소마다 최대 3시간에 한 번 조건부
  요청으로 확인하고, 새 릴리스는 바로 알리되 `.nro` 는 기기가 처음 받을 때 내려받아
  `data/homebrew/` 에 둡니다. GitHub 에 없는 앱은 `/homebrew` 에 읽기 전용으로 마운트한 폴더에
  `<앱>/<앱>.nro` 로 넣습니다. `COOK_GITHUB_TOKEN` 은 선택이며 GitHub 의 시간당 한도만 늘립니다.
- **Dropbox 세이브 동기화(CookingFoil 클라이언트):** dropbox.com/developers/apps 에서 앱을
  만들고(Scoped access, App folder) 리다이렉트 URI
  `https://<내 서버 주소>/api/dropbox/oauth/dropbox/callback` 을 넣은 뒤 `COOK_DROPBOX_APP_KEY`
  (앱 키만, 비밀값은 넣지 않습니다)와 `COOK_PUBLIC_BASE_URL=https://<내 서버 주소>` 를 정합니다.
  클라이언트가 각자의 Dropbox 에 세이브를 백업하고, 세이브는 서버를 거치지 않습니다.
- **세이브 파일(CookingFoil 클라이언트):** `/saves` 에 폴더를 마운트(또는 `COOK_SAVES_DIR`)하고
  `<본편 TITLE ID>/<세이브 이름>/<세이브 폴더 내용 그대로>` 로 둡니다. 선택 `meta.json`
  (`name`, `description`, `gameVersion`). 세이브 하나에 1GB·파일 5,000개까지, 심볼릭 링크는 거절합니다.
- **RetroArch(CookingFoil 클라이언트):** `data/retro/` 를 만듭니다(다른 곳에 두려면
  마운트하고 `COOK_RETRO_DIR` 을 정합니다).
  ```
  retro/
  ├── roms/<시스템>/                          내 파일
  ├── thumbnails/<시스템>/Named_Boxarts/      박스아트(libretro-thumbnails 구조 그대로)
  ├── bezels/<시스템>/                        The Bezel Project: <이름>.png (+ .cfg), 나머지용 _default.png
  ├── retroarch/                              retroarch.nro, retroarch.cfg, cores/, assets/, system/(바이오스)
  └── systems.json                            선택: 시스템의 코어를 바꾸거나 시스템을 더합니다
  ```
  여기 들어가는 것은 CookingFoil 에 하나도 포함돼 있지 않습니다. RetroArch, 코어, BIOS 파일,
  콘텐츠는 모두 직접 넣고, 폴더는 비어 있는 채로 시작합니다.
  `<시스템>` 은 RetroArch 이름("Sony - PlayStation", "Sega - Mega Drive - Genesis" 등),
  짧은 id(gba, ps1 등), 흔한 별칭(FC, SFC, MD, PS1, PSP) 중 무엇이든 되고 대소문자는 가리지
  않습니다. NES, SNES, GB, GBC, GBA, N64, NDS, 메가 드라이브, 메가 CD, 마스터 시스템, 게임 기어,
  새턴, PC 엔진, PC 엔진 CD, 플레이스테이션, PSP, 네오지오 포켓, 원더스완, 아케이드(FBNeo)를
  지원합니다. 기종 아이콘은 `system-icons/{color,mono}/<시스템>.png` 에 두면
  `/api/retro/systems` 에 붙습니다.
  박스아트와 베젤: `node scripts/retro-art.mjs <레트로 폴더>` 가 libretro-thumbnails 와
  The Bezel Project 에서 받아 옵니다. 이름을 바꾼 한글 패치 롬은 `art-map/<시스템>.json`
  (`{"<롬 이름>": "<No-Intro 이름>"}`) 이 있어야 찾습니다. 이미 있는 파일은 두므로 파일을
  더한 뒤 다시 돌리면 됩니다.
  평점: `node scripts/retro-ratings.mjs <레트로 폴더> <Metadata.xml>`(gamesdb.launchbox-app.com/Metadata.zip
  안의 파일)이 art-map 의 원제를 LaunchBox Games DB 와 맞춰 `ratings.json` 을 씁니다.
  `/api/retro/games?sort=rating` 과 `/api/retro/home` 이 이것을 씁니다.
  서버는 이 파일들을 하나도 담고 있지 않으니 직접 넣습니다. `retroarch.nro` 는
  `sdmc:/switch/retroarch_switch.nro` 로, `retroarch/` 의 나머지는 `sdmc:/retroarch/` 로 가고,
  `retroarch.cfg` 는 카드에 없을 때만 씁니다. 플레이스테이션은 `.chd`, `.pbp`, 또는 트랙 파일을
  옆에 둔 `.cue` 입니다.
- **공개 상점 정보:** 가격, 인기 순위, 아트가 기본으로 켜져 있습니다.
  `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` 를 `false`
  로 두면 그 서비스에 접속하지 않습니다.

## 8. 업데이트와 백업

```bash
docker compose pull && docker compose up -d
```

`data/` 를 백업하세요(계정과 기기는 `data/security/` 에 있습니다). 나머지는
서버가 다시 만들 수 있습니다.
