# CookingFoil 운영 안내

이 문서는 관리 페이지(`/admin`)에서 할 수 있는 일을 정리한 것입니다. 모든 일은 관리 페이지만으로 할 수 있습니다. AI 도우미(Claude 같은 LLM)에게 맡기려면 맨 아래 "AI 도우미에게 맡기기"를 따릅니다. 이 문서를 그대로 건네면 됩니다.

## 1. 처음 설치

1. `docker compose up -d` 로 띄웁니다.
2. `docker compose logs cookingfoil | grep "setup code"` 로 설정 코드를 확인합니다. 코드는 켤 때마다 바뀝니다.
3. 브라우저로 서버 주소를 열면 처음 설정 화면이 나옵니다. 설정 코드, 관리자 계정, 인증 앱 등록 순서로 진행합니다.
4. 끝나면 관리 페이지가 열립니다. 이후 관리 페이지는 계정 로그인 뒤 관리자 비밀번호나 인증 앱의 6자리 코드를 한 번 더 묻습니다. 관리자 역할의 구글 계정으로 로그인했으면 묻지 않습니다.

설정은 모두 선택입니다. 기기 연결, 웹 업로드, 공개 주소, 이름 언어, 게임 정보 받기, 외부 정보는 설정 탭의 서버 동작에서 바꾸고 바로 적용합니다. 거기서 바꾸지 않은 것은 `.env` 값을 쓰고, `.env` 의 값은 `.env.example` 에 설명이 있습니다.

## 2. 사용자와 기기 (사용자 · 기기 탭)

- **계정**: 사용자 탭에서 만들고, 끄고, 비밀번호를 바꿉니다. 역할은 관리자와 일반 사용자 둘입니다.
- **기기별 접속 정보**: 기기 탭에서 콘솔 하나에만 묶이는 접속 정보를 만듭니다. 처음 쓴 콘솔에 묶이고 언제든 끊을 수 있어 계정 비밀번호를 콘솔에 넣는 것보다 안전합니다.
- **기기 승인**: 설정 탭의 서버 동작에서 "QR 로 기기 연결"을 켜면 클라이언트에 QR 이 뜹니다. 휴대폰으로 찍어 승인하거나 기기 탭에서 승인합니다. 승인 방식(직접 승인, 로그인한 기기는 바로 승인, 모두 승인)도 거기서 고릅니다.
- **잠금 풀기**: 비밀번호를 여러 번 틀린 주소는 잠깁니다. 로그 탭에서 풉니다.

## 3. 외부 서비스 키 (설정 탭)

모두 선택이고, 없으면 그 기능만 꺼집니다. 저장하면 바로 적용하고 시크릿은 다시 보여 주지 않습니다. "연결 확인"으로 키가 맞는지 봅니다.

| 서비스 | 용도 | 발급처 |
|---|---|---|
| IGDB | 평점에 IGDB 점수를 더합니다 | https://dev.twitch.tv/console/apps (Twitch 계정에 2단계 인증 필요). 리디렉션 URL `http://localhost`, 분류 Application Integration, 기밀 클라이언트 |
| SteamGridDB | 표지를 직접 고를 때 후보를 보여 줍니다 | https://www.steamgriddb.com/profile/preferences/api |
| Dropbox | 클라이언트의 세이브 동기화 로그인을 이어 줍니다 | https://www.dropbox.com/developers/apps (Scoped access, App folder, files.content.read/write, 화면에 보이는 리디렉션 주소 등록). App key 만 넣습니다 |
| GitHub | 표지·베젤 목록과 홈브류 확인의 GitHub 한도를 시간당 60회에서 5,000회로 올립니다. 없으면 한도에 걸렸을 때 베젤 지역판 폴백과 홈브류 확인이 멈춥니다 | https://github.com/settings/personal-access-tokens/new (Public repositories, 권한 추가 없음) |
| 평점 서버 | 따로 운영하는 oc-scraper 에서 평점을 받습니다 | 그 서버 주소 |

구글 로그인도 설정 탭에서 켭니다. 구글 클라우드 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 화면에 보이는 리디렉션 주소를 등록합니다.

## 4. 레트로 표지와 베젤 (레트로 탭)

- 파일 이름은 `한글명 (English) [패치정보]` 형식을 씁니다. 괄호 안 영어 제목으로 libretro 표지 목록에서 짝을 찾습니다.
- **빠진 것 모두 받기**: 짝을 못 찾은 항목을 맞추고, 표지와 베젤 프로젝트 베젤을 받습니다. 이미 있는 파일은 그대로 둡니다. 업로드하면 그 시스템만 저절로 받습니다.
- **맞추기**: 표지가 없는 항목에서 제목을 검색해 고르면 표지와 베젤이 그 이름을 따라갑니다. libretro 에 없으면 SteamGridDB 에서 표지를 고를 수 있습니다(키 필요).
- **표지 없음으로 두기**: 맞는 표지가 없는 항목을 자동 맞춤에서 뺍니다.
- 아케이드는 FBNeo 세트 이름(`mslug.zip`)을 그대로 쓰고, 이름과 표지는 내장 목록으로 정해집니다. 이름을 고치려면 레트로 폴더의 `arcade-names.json` 에 `{"mslug": {"ko": "메탈 슬러그"}}` 처럼 넣습니다.

## 5. 홈브류 (홈브류 탭)

- GitHub 저장소 주소를 넣으면 최신 릴리스를 따라갑니다. 확인 주기는 `COOK_HOMEBREW_CHECK_HOURS`(기본 6시간)이고 "지금 확인"으로 바로 볼 수 있습니다.
- 릴리스 zip 이 `switch/<앱>/` 폴더 하나로 깔끔하면 폴더째, 아니면 `.nro` 하나로 내려 줍니다. 관리 화면에 어느 쪽인지와 그 이유가 나옵니다.

## 6. 업로드와 라이브러리 (업로드 · 라이브러리 탭)

- 업로드 탭에서 파일, 레트로 파일, 패치, 세이브를 올립니다. 레트로는 시스템을 고르고 올립니다.
- 파일을 서버 폴더에 직접 넣었다면 라이브러리 탭의 "다시 읽기"로 반영합니다.

## 7. 문제가 생기면

- **콘솔이 접속하지 못합니다**: 개요 탭의 경고와 로그 탭의 거절 기록을 봅니다. 거절마다 이유가 적혀 있습니다.
- **기기가 서버 이름을 못 찾습니다**(로그 탭에 기록이 하나도 없는데 기기만 "응답이 없습니다"): 서버까지 오지도 못한 것입니다. 공유기 DNS 가 응답하지 않는 경우가 많습니다. 기기의 인터넷 설정에서 DNS 를 수동으로 `1.1.1.1` (보조 `8.8.8.8`) 로 바꾸거나, 공유기의 DHCP 가 나눠 주는 DNS 를 그렇게 바꿉니다.
- **관리 페이지에 못 들어갑니다**: 인증 앱을 잃었다면 `.env` 에 `COOK_ADMIN_PASSWORD`(12자 이상)를 넣고 다시 켜면 비밀번호로 들어갈 수 있습니다.
- **내 주소가 잠겼습니다**: `COOK_RESET_LOCKOUTS=true` 로 한 번 켰다가 다시 지웁니다.

## AI 도우미에게 맡기기

AI 도우미는 관리 페이지가 쓰는 것과 같은 API 를 부릅니다. 브라우저 대신 **자동화 토큰**으로 들어갑니다.

1. 설정 탭의 "자동화 토큰"에서 토큰을 만듭니다. 토큰은 만들 때 한 번만 보입니다.
2. 도우미에게 서버 주소, 토큰, 이 문서(`/admin/guide.md`)를 건넵니다.
3. 다 쓰면 같은 곳에서 토큰을 지웁니다.

토큰은 만든 관리자 계정으로 동작하고 `/admin/api/` 아래에서만 통합니다. 계정, 로그인 방식, 토큰은 바꿀 수 없습니다. 토큰이 새면 바로 지웁니다.

### 도우미를 위한 요약

- 모든 요청에 `Authorization: Bearer <토큰>` 을 붙입니다. 본문은 JSON 이고 `Content-Type: application/json` 을 씁니다.
- 바꾸기 전에 GET 으로 지금 상태를 먼저 읽습니다. 지우는 요청은 사람에게 확인받고 보냅니다.
- 오류는 `{ "error": "…" }` 로 옵니다. 401 은 토큰이 틀렸거나 지워진 것, 403 은 토큰으로 할 수 없는 일입니다.

```sh
BASE=http://서버:9080; TOKEN=cft_...
curl -s -H "Authorization: Bearer $TOKEN" $BASE/admin/api/stats
```

| 하는 일 | 요청 |
|---|---|
| 서버 상태와 경고 | `GET /admin/api/stats` |
| 레트로 표지·베젤 현황, 표지 없는 항목 | `GET /admin/api/retro-art` |
| 빠진 표지·베젤 받기 (진행은 위 GET 의 `job`) | `POST /admin/api/retro-art/sync` `{ "system": "snes" }` (생략하면 전부) |
| 한 항목의 표지 후보 | `GET /admin/api/retro-art/candidates?game=<id>&q=<영어 제목>` |
| 후보로 맞추기 / 표지 없음 | `POST /admin/api/retro-art/match` `{ "game": "<id>", "name": "<후보 이름>" }` / `"name": null` |
| SteamGridDB 검색, 표지 목록, 적용 | `GET /admin/api/retro-art/sgdb?q=` → `GET /admin/api/retro-art/sgdb/<번호>` → `POST /admin/api/retro-art/cover` `{ "game", "url" }` |
| 외부 서비스 키 상태, 저장, 확인 | `GET /admin/api/integrations`, `POST /admin/api/integrations/<igdb\|steamgriddb\|dropbox\|github\|ratings>`, `POST …/<서비스>/test` |
| 홈브류 목록, 추가, 지금 확인 | `GET /admin/api/homebrew`, `POST /admin/api/homebrew` `{ "repo": "owner/name" }`, `POST /admin/api/homebrew/check` |
| 라이브러리 목록, 다시 읽기 | `GET /admin/api/library`, `POST /admin/api/library/rescan` |
| 서버 동작 보기, 바꾸기 (null 이면 compose 값으로), 게임 정보 지금 받기 | `GET /admin/api/server-settings`, `POST /admin/api/server-settings` `{ "devicePairing": true }`, `POST /admin/api/server-settings/titledb-refresh` |
| 게임 패치 목록, 필수 표시 (없으면 게임이 실행되지 않는 패치) | `GET /admin/api/patches`, `POST /admin/api/patches/required` `{ "id": "<패치 id>", "required": true }` |
| 게임 소개와 추가 정보 직접 쓰기 (titledb 갱신이 덮어쓰지 않음) | `GET /admin/api/descriptions/<타이틀 ID>`, `POST /admin/api/descriptions/<타이틀 ID>` `{ "description": { "ko", "en" }, "notes": { "ko", "en" } }`, `POST …/<타이틀 ID>/reset` |
| 기기 목록, 승인, 이름, 끊기 | `GET /admin/api/devices`, `POST /admin/api/devices/approve` `{ "code": "<기기 코드>" }`, `…/label`, `…/revoke` |
| 기기별 접속 정보 | `GET /admin/api/device-logins`, `POST /admin/api/device-logins` `{ "label" }`, `POST …/<이름>/revoke` |
| 잠긴 주소 풀기 | `POST /admin/api/unlock` `{ "ip" }` |
| 클라이언트 오류 기록 | `GET /admin/api/client-logs` |
