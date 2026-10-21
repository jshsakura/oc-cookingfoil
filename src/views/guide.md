# CookingFoil 운영 안내

이 문서는 관리 페이지(`/admin`)에서 할 수 있는 일을 정리한 것입니다. 모든 일은 관리 페이지만으로 할 수 있습니다. AI 도우미(Claude 같은 LLM)에게 맡기려면 맨 아래 "AI 도우미에게 맡기기"를 따릅니다. 이 문서를 그대로 건네면 됩니다.

## 1. 처음 설치

1. `docker compose up -d` 로 띄웁니다.
2. `docker compose logs cookingfoil | grep "setup code"` 로 설정 코드를 확인합니다. 코드는 켤 때마다 바뀝니다.
3. 브라우저로 서버 주소를 열면 처음 설정 화면이 나옵니다. 설정 코드, 관리자 계정, 인증 앱 등록 순서로 진행합니다.
4. 끝나면 관리 페이지가 열립니다. 이후 관리 페이지는 계정 로그인 뒤 관리자 비밀번호나 인증 앱의 6자리 코드를 한 번 더 묻습니다. 관리자 역할의 구글 계정으로 로그인했으면 묻지 않습니다.

설정은 모두 선택입니다. 기기 연결, 웹 업로드, 공개 주소, 이름 언어, 게임 정보 받기, 외부 정보는 설정 탭의 서버 동작에서 바꾸고 바로 적용합니다. 거기서 바꾸지 않은 것은 `.env` 값을 쓰고, `.env` 의 값은 `.env.example` 에 설명이 있습니다.

## 2. 사용자와 기기 (사용자 · 기기 탭)

- **계정**: 사용자 탭에서 만들고, 끄고, 비밀번호를 변경합니다. 역할은 관리자와 일반 사용자 둘입니다.
- **기기 승인**: 설정 탭의 서버 동작에서 "QR 로 기기 연결"을 켜면 클라이언트에 QR 이 뜹니다. 휴대폰으로 찍어 승인하거나 기기 탭에서 승인합니다. 승인 방식(직접 승인, 로그인한 기기는 바로 승인, 모두 승인)도 거기서 고릅니다. 콘솔은 비밀번호로 계속 접속하지 않습니다. 아이디와 비밀번호는 연결할 때 한 번만 받아 콘솔을 바로 승인하는 데 쓰고, 그 뒤로는 기기 키로만 접속합니다.
- **잠금 풀기**: 비밀번호를 여러 번 틀린 주소는 잠깁니다. 로그 탭에서 풉니다.

## 3. 외부 서비스 키 (설정 탭)

모두 선택이고, 없으면 그 기능만 꺼집니다. 저장하면 바로 적용하고 시크릿은 다시 보여 주지 않습니다. "연결 확인"으로 키가 맞는지 봅니다.

| 서비스 | 용도 | 발급처 |
|---|---|---|
| IGDB | 평점에 IGDB 점수를 더합니다 | https://dev.twitch.tv/console/apps (Twitch 계정에 2단계 인증 필요). 리디렉션 URL `http://localhost`, 분류 Application Integration, 기밀 클라이언트 |
| SteamGridDB | 표지를 직접 고를 때 후보를 보여 줍니다 | https://www.steamgriddb.com/profile/preferences/api |
| Dropbox | 클라이언트의 세이브 동기화 로그인을 이어 줍니다 | https://www.dropbox.com/developers/apps (Scoped access, App folder, files.content.read/write, 화면에 보이는 리디렉션 주소 등록). App key 만 넣습니다 |
| GitHub | 표지·베젤 목록과 홈브류 확인의 GitHub 한도를 시간당 60회에서 5,000회로 올립니다. 없으면 한도에 걸렸을 때 베젤 지역판 폴백과 홈브류 확인이 멈춥니다 | https://github.com/settings/personal-access-tokens/new (Public repositories, 권한 추가 없음) |

구글 로그인도 설정 탭에서 켭니다. 구글 클라우드 콘솔의 OAuth 클라이언트(웹 애플리케이션)에 화면에 보이는 리디렉션 주소를 등록합니다.

## 4. 레트로 표지와 베젤 (레트로 탭)

- 파일 이름은 `한글명 (English) [패치정보]` 형식을 씁니다. 괄호 안 영어 제목으로 libretro 표지 목록에서 짝을 찾습니다.
- **빠진 것 모두 받기**: 짝을 못 찾은 항목을 맞추고, 표지와 베젤 프로젝트 베젤을 받습니다. 이미 있는 파일은 그대로 둡니다. 업로드하면 그 시스템만 저절로 받습니다.
- **맞추기**: 표지가 없는 항목에서 제목을 검색해 고르면 표지와 베젤이 그 이름을 따라갑니다. libretro 에 없으면 SteamGridDB 에서 표지를 고를 수 있습니다(키 필요).
- **표지 없음으로 두기**: 맞는 표지가 없는 항목을 자동 맞춤에서 뺍니다.
- 아케이드는 FBNeo 세트 이름(`mslug.zip`)을 그대로 쓰고, 이름과 표지는 내장 목록으로 정해집니다. 이름을 고치려면 레트로 폴더의 `arcade-names.json` 에 `{"mslug": {"ko": "메탈 슬러그"}}` 처럼 넣습니다.
- ScummVM 게임은 ScummVM 게임 아이디로 폴더와 파일 이름을 맞춥니다(`ScummVM/monkey2/monkey2.scummvm`, 파일 안에도 `monkey2`). 원본 게임 파일은 그 폴더에 그대로 두면 하위 폴더까지 함께 내려갑니다. 한글 제목은 레트로 탭 목록의 이름 버튼으로 붙입니다(서버의 `retro-names.json` 에 남습니다).

## 5. 홈브류 (홈브류 탭)

- GitHub 저장소 주소를 넣으면 최신 릴리스를 따라갑니다. 확인 주기는 `COOK_HOMEBREW_CHECK_HOURS`(기본 6시간)이고 "지금 확인"으로 바로 볼 수 있습니다.
- 릴리스 zip 이 `switch/<앱>/` 폴더 하나로 깔끔하면 폴더째, 아니면 `.nro` 하나로 내려 줍니다. 관리 화면에 어느 쪽인지와 그 이유가 나옵니다.

## 6. 업로드와 라이브러리 (업로드 · 라이브러리 탭)

- 업로드 탭에서 파일, 레트로 파일, 패치, 세이브를 올립니다. 레트로는 시스템을 고르고 올립니다.
- 파일을 서버 폴더에 직접 넣었다면 라이브러리 탭의 "다시 읽기"로 반영합니다.

### 임시 공유 (임시 공유 탭)

- 로그인한 사용자는 대시보드의 계정 메뉴에서 파일, 메모, 링크를 남깁니다. 남기면 텔레그램 알림(임시 공유)이 바로 갑니다.
- 남긴 것은 서버의 `data/inbox/<날짜-시각>-<사용자>-<4자리>/` 에 하나씩 있습니다. `files/` 에 원래 이름 그대로의 파일이, `note.json` 에 `{ user, at, memo, links, files: [{ name, size, sha256 }] }` 가 있습니다. 정리함으로 보낸 것에는 `status.json` 이 생깁니다.
- 패치, 세이브, 홈브류로 옮긴 뒤에는 정리함으로 보내거나 삭제합니다. 켜고 끄기, 한 번에 올리는 크기, 전체 크기는 설정 탭의 "임시 공유"에서 변경합니다.

## 7. 문제가 생기면

- **콘솔이 접속하지 못합니다**: 개요 탭의 경고와 로그 탭의 거절 기록을 봅니다. 거절마다 이유가 적혀 있습니다.
- **기기가 서버 이름을 못 찾습니다**(로그 탭에 기록이 하나도 없는데 기기만 "응답이 없습니다"): 서버까지 오지도 못한 것입니다. 공유기 DNS 가 응답하지 않는 경우가 많습니다. 기기의 인터넷 설정에서 DNS 를 수동으로 `1.1.1.1` (보조 `8.8.8.8`) 로 바꾸거나, 공유기의 DHCP 가 나눠 주는 DNS 를 그렇게 변경합니다.
- **관리 페이지에 못 들어갑니다**: 설정 탭에서 관리자 비밀번호를 정해 두면 인증 앱을 잃어도 비밀번호로 들어갑니다. 둘 다 잃었다면 `.env` 에 `COOK_ADMIN_PASSWORD`(12자 이상)를 넣고 다시 켜면 그 비밀번호로 들어갈 수 있습니다.
- **내 주소가 잠겼습니다**: `COOK_RESET_LOCKOUTS=true` 로 한 번 켰다가 다시 삭제합니다.

## AI 도우미에게 맡기기

AI 도우미는 관리 페이지가 쓰는 것과 같은 API 를 부릅니다. 브라우저 대신 **자동화 토큰**으로 들어갑니다.

1. 설정 탭의 "자동화 토큰"에서 토큰을 만듭니다. 토큰은 만들 때 한 번만 보입니다.
2. 도우미에게 서버 주소, 토큰, 이 문서(`/admin/guide.md`)를 건넵니다.
3. 다 쓰면 같은 곳에서 토큰을 삭제합니다.

토큰은 만든 관리자 계정으로 동작하고 `/admin/api/` 아래와 파일 목록 `/shop.json` 에서만 통합니다. 계정, 로그인 방식, 토큰, 기기 승인, 알림 설정은 바꿀 수 없고, 서버 동작 중 기기 승인·접속 방식과 공개 주소에 관한 값도 바꿀 수 없습니다. 기기가 설치하는 파일도 건드리지 못합니다. 클라이언트 빌드와 홈브류, 패치 파일을 올리거나, 게임이 꼭 받아야 할 패치로 표시하거나, 클라이언트 릴리스를 받아 올 곳을 바꾸거나 확인을 돌리거나, 따라갈 GitHub 홈브류 저장소와 그 릴리스 파일을 고르는 일이 여기에 해당합니다. 이런 일은 사람이 관리 페이지에서 합니다. 토큰이 새면 바로 삭제합니다.

### 도우미를 위한 요약

- 모든 요청에 `Authorization: Bearer <토큰>` 을 붙입니다. 본문은 JSON 이고 `Content-Type: application/json` 을 씁니다.
- 변경 전에 GET 으로 지금 상태를 먼저 읽습니다. 지우는 요청은 사람에게 확인받고 보냅니다.
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
| 외부 서비스 키 상태, 저장, 확인 | `GET /admin/api/integrations`, `POST /admin/api/integrations/<igdb\|steamgriddb\|dropbox\|github\|telegram>`, `POST …/<서비스>/test` |
| 홈브류 목록, 추가, 지금 확인 | `GET /admin/api/homebrew`, `POST /admin/api/homebrew` `{ "repo": "owner/name" }`, `POST /admin/api/homebrew/check` |
| 홈브류 앱 켜기·끄기 (끄면 기기 목록에서만 빠짐), 저장소 빼기, 직접 넣은 앱 삭제 | `POST /admin/api/homebrew/enabled` `{ "id", "enabled": false }`, `POST /admin/api/homebrew/remove` `{ "repo" }`, `POST /admin/api/homebrew/manual/remove` `{ "id" }` |
| 라이브러리 목록, 다시 읽기 | `GET /admin/api/library`, `POST /admin/api/library/rescan` |
| 게임 파일 찾기, 삭제 | `GET /admin/api/library/files?q=`, `POST /admin/api/library/files/remove` `{ "rel" }` |
| 라이브러리 파일을 종류별로 보기 (읽기만 합니다. 아래 "파일 목록 API" 참조) | `GET /admin/api/library/browse?kind=base&page=1&perPage=50` |
| 레트로 게임 이름 정하기 (파일 이름은 그대로, 둘 다 비우면 파일 이름으로) | `POST /admin/api/retro-art/games/name` `{ "game": "<id>", "ko", "en" }` |
| 레트로 게임 롬 삭제 (표지는 남음) | `POST /admin/api/retro-art/games/remove` `{ "game": "<id>" }` |
| 서버 동작 보기, 변경 (null 이면 compose 값으로, 기기 승인·접속 방식·공개 주소·다운로드 링크 수명은 제외), 게임 정보 지금 받기 | `GET /admin/api/server-settings`, `POST /admin/api/server-settings` `{ "welcomeMessage": "…" }`, `POST /admin/api/server-settings/titledb-refresh` |
| 게임 패치 목록, 필수 표시 (없으면 게임이 실행되지 않는 패치) | `GET /admin/api/patches`, `POST /admin/api/patches/required` `{ "id": "<패치 id>", "required": true }` (필수 표시는 토큰으로 할 수 없습니다) |
| 게임 세이브 목록, 패치·세이브 편집, 다른 게임으로 옮기기, 삭제 | `GET /admin/api/saves`, `POST /admin/api/content/<patch\|save>/meta` `{ "id", "name", "nameKo", "description", "descriptionKo", … }`, `…/move` `{ "id", "titleId" }`, `…/remove` `{ "id" }` |
| 게임 이름, 소개, 추가 정보 직접 쓰기 (titledb 갱신이 덮어쓰지 않음) | `GET /admin/api/descriptions/<타이틀 ID>`, `POST /admin/api/descriptions/<타이틀 ID>` `{ "name": { "ko", "en" }, "description": { "ko", "en" }, "notes": { "ko", "en" } }`, `POST …/<타이틀 ID>/reset` |
| 기기 목록 (보기만 합니다) | `GET /admin/api/devices` |
| 잠긴 주소 풀기 | `POST /admin/api/unlock` `{ "ip" }` |
| 클라이언트 오류 기록 | `GET /admin/api/client-logs` |
| 클라이언트 빌드 상태(받는 방식, 내려주는 빌드와 출처), 지금 가져오기 (설정은 서버 동작의 `clientSource` `clientReleaseRepo` `clientReleaseTag` `clientReleaseAsset`. 기본은 `manual` 로 올린 빌드만 쓰고, `github` 는 `jshsakura/oc-cookingfoil-client` 의 최신 릴리스를 따릅니다. 태그를 넣으면 그 태그의 릴리스를 따릅니다) | `GET /admin/api/client-release`, `POST /admin/api/client-release/check` |
| 임시 공유 목록 (open 정리할 것, done 정리함, all 전체), 파일 받기 | `GET /admin/api/inbox?show=open`, `GET /admin/api/inbox/<id>/file?path=<files/ 안의 경로>` |
| 임시 공유 정리함으로 보내기, 되돌리기, 삭제 | `POST /admin/api/inbox/<id>/done` `{ "done": true }`, `DELETE /admin/api/inbox/<id>` |

### 파일 목록 API

`GET /admin/api/library/browse` 는 서버가 내주는 파일을 종류별로 나눠 페이지로 돌려줍니다. 응답에는 언제나 `total`(조건에 맞는 수)과 `counts`(종류별 수)가 들어 있습니다. `counts` 에는 종류를 뺀 나머지 조건이 모두 적용됩니다.

| 매개변수 | 값 |
|---|---|
| `kind` | `base` `update` `dlc` `patch` `save` `homebrew` `other` 중 하나 이상, 쉼표로 나눕니다 (기본 `base`). `other` 는 게임 폴더에 있지만 게임 파일이 아닌 것입니다 |
| `q` | 이름, 경로, 타이틀 ID 에서 찾을 글자 (200자까지) |
| `ext` | 확장자, 쉼표로 나눕니다 (예: `nsp,xci`) |
| `minSize` `maxSize` | 바이트 |
| `modifiedSince` | epoch 초나 ISO 날짜 |
| `integrity` | `ok` `modified` `damaged` `unchecked` 중 하나 이상. 게임 파일에만 값이 있습니다 |
| `sort` `order` | `name` `size` `mtime`, `asc` `desc` (기본 이름 오름차순) |
| `page` `perPage` | 1부터, 한 페이지 1에서 500개 (기본 50). 마지막 페이지를 넘으면 마지막 페이지를 돌려줍니다 |
| `fields` | 받을 항목만 쉼표로 고릅니다 (예: `rel,size,kind`) |
| `counts_only` | `1` 이면 `{ counts, total }` 만 돌려줍니다 |

항목은 늘 같은 모양이고 모르는 값은 `null` 입니다: `{ name, kind, rel, size, mtime, ext, titleId, version, integrity }`. `rel` 은 그 종류의 폴더 안 경로이고 `mtime` 은 epoch 초입니다. 응답 바깥은 `{ items, total, page, perPage, pages, sort, order, counts }` 입니다. 잘못된 매개변수는 400 `{ "error": "…", "code": "bad-param", "param": "<이름>" }` 으로 옵니다.

| 하는 일 | 요청 |
|---|---|
| 종류별 파일 수 | `GET /admin/api/library/browse?counts_only=1` |
| 손상된 게임 파일 목록 | `GET /admin/api/library/browse?kind=base,update,dlc&integrity=damaged&fields=rel,size,integrity&perPage=500` |
| 큰 파일 찾기 (10GB 이상, 큰 것부터) | `GET /admin/api/library/browse?kind=base,update,dlc&minSize=10737418240&sort=size&order=desc&fields=rel,size` |
| 게임이 아닌 파일 정리 대상 | `GET /admin/api/library/browse?kind=other&perPage=500&fields=rel,size,mtime` |
| 하루 사이에 들어온 업데이트 | `GET /admin/api/library/browse?kind=update&modifiedSince=<epoch 초>&sort=mtime&order=desc` |
