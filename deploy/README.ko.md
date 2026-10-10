# 만든 사람처럼 cookingfoil 운영하기

[English](./README.md)

이 폴더는 그대로 돌아가는 전체 설정입니다. 컨테이너 하나, 게임 폴더, 계정,
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

게임은 어디에 있어도 되고 `GAMES_DIR` 로 그 폴더를 지정합니다. 하위 폴더와
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

`http://<호스트>:38000/` 을 열고 계정으로 로그인합니다. 대시보드에 샵 주소와
이름이 titledb·게임 파일·파일 이름 중 어디서 오는지, 무엇이 빠졌는지가 나옵니다.

## 4. 스위치 연결

- **CyberFoil:** 설정의 *eShop URL* = `http://<호스트>:38000/` 과 아이디·비밀번호.
  `COOK_DEVICE_PAIRING=true` 면 대신 휴대폰으로 기기를 승인할 수 있습니다.
- **Tinfoil 계열:** *File Browser* → `+` → `http://<호스트>:38000/shop.tfl`.
- **CookingFoil 클라이언트:** 관리 페이지에서 사용자를 만들면 보여 주는
  `config.json` 을 `sdmc:/switch/cookingfoil/config.json` 에 둡니다.

## 5. 관리 페이지

`/admin` 을 엽니다. `COOK_ADMIN_PASSWORD` 가 없으면 **같은 네트워크에서** 처음
들어갈 때 인증 앱용 설정 키가 나오고, 첫 코드가 맞으면 다시는 나오지 않습니다.
`COOK_ADMIN_PASSWORD` 를 두면 대신 그 비밀번호를 묻습니다(밖에서만 들어갈 때
편합니다).

여기서 계정 추가·삭제, 기기 승인, 잠금 해제, 클라이언트 홈 추천 줄, 다시 스캔을
합니다.

## 6. 밖에서 접속하기

리버스 프록시(Caddy, nginx, Traefik)나 터널(Cloudflare Tunnel, Tailscale)로 HTTPS
뒤에 둡니다. 프록시가 같은 호스트에 있으면 `COOK_TRUST_PROXY` 를
`loopback, uniquelocal` 로 두어야 비밀번호를 틀린 그 기기만 잠기고 프록시 뒤
전원이 함께 잠기지 않습니다.

스위치 앱은 Cloudflare Access 같은 브라우저 로그인 화면을 통과하지 못하므로,
샵 주소에는 샵 자체 계정(과 기기 페어링)을 쓰세요.

## 7. 선택 기능

- **prod.keys:** 내 기기의 `prod.keys` 를 `keys/` 에 넣으면 titledb 에 없는
  게임도 파일에서 실제 이름과 아이콘을 읽습니다.
- **리뷰 점수:** 기본으로 켜져 있습니다(Steam). IGDB 점수도 원하면 dev.twitch.tv
  에서 앱을 만들고 `COOK_IGDB_CLIENT_ID` / `COOK_IGDB_CLIENT_SECRET` 을 넣습니다.
- **유저 패치:** `patches/<본편 TITLE ID>/<패치 이름>/atmosphere/contents/<TITLE ID>/cheats/…`
  (또는 `romfs/`, `exefs/`, `atmosphere/exefs_patches/<이름>/`,
  `SaltySD/plugins/FPSLocker/patches/<TITLE ID>/`) 와 선택 `patch.json`
  (`name`, `version`, `game_version`, `author`, `description`). 이 경로 밖의 파일이
  하나라도 있으면 그 패치는 건너뜁니다.
- **닌텐도 eShop 정보:** 가격, 인기 순위, 아트가 기본으로 켜져 있습니다.
  `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` 를 `false`
  로 두면 닌텐도에 접속하지 않습니다.

## 8. 업데이트와 백업

```bash
docker compose pull && docker compose up -d
```

`data/` 를 백업하세요(계정과 기기는 `data/security/` 에 있습니다). 나머지는
서버가 다시 만들 수 있습니다.
