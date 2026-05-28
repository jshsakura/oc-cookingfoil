# tinfoil-hat — 프로젝트 분석 (Rebuild 기준 정리)

> 목적: 원본(`vinicioslc/tinfoil-hat`)을 **내 컨테이너로 완전히 다시 만들기** 위한 분석.
> 깃 이력 제거 후 새로 시작 예정 — upstream 기여 목적 아님.

---

## 1. 한 줄 요약

Nintendo Switch의 **Tinfoil** 앱이 로컬 네트워크에서 게임 파일(`.nsp/.nsz/.xci/.zip`)을
다운로드할 수 있도록, 폴더의 파일을 스캔해 `shop.json` / `shop.tfl` 인덱스를 **실시간 동적 생성**해
주는 경량 Node.js(Express) 서버. NUT 대비 RAM 사용량이 매우 낮음(README 주장: 1.5GB→57MB).

## 2. 기술 스택

| 영역 | 사용 |
|------|------|
| 런타임 | Node.js (ESM, `"type": "module"`). Dockerfile=`node:19-alpine3.16`(EOL), volta=node16, 로컬=node24 — **불일치** |
| 웹 서버 | `express` 4 |
| 파일 인덱스 | `serve-index` (커스텀 HTML 템플릿), `fast-glob` (게임 파일 스캔) |
| 설정 파싱 | `json5` (`shop_template.jsonc` 주석 허용), `dotenv` |
| 인증 | `express-basic-auth` (`AUTH_USERS` env 기반) |
| 세이브 동기화 | `basic-ftp` (스위치 sys-ftpd에서 세이브 백업 pull) |
| 네트워크 | `local-ip-address`, `public-ip`, `local-devices` |
| 테스트 | Playwright (E2E) |
| 배포 | Docker + docker-compose + Watchtower 자동업데이트, GitHub Actions로 Docker Hub 멀티아치 push |

## 3. 동작 흐름

```
요청 ──▶ [basic-auth (AUTH_USERS 있을 때만)]
       └▶ [shop-file-builder 미들웨어]
            ├─ /shop.json  → generateIndex() → JSON 반환
            ├─ /shop.tfl   → 요청 IP 기록(세이브 동기 대상) → octet-stream 반환
            └─ 그 외        → next()
       └▶ express.static(games)        # 실제 게임 파일 다운로드
       └▶ serve-index(games, 커스텀 HTML) # 브라우저 디렉터리 리스팅
```

- **인덱스 생성**(`src/create-index-content.js`): 매 요청마다 `fast-glob`로 게임 폴더를 다시 스캔 →
  refresh 간격 없이 즉시 반영. 파일명은 Tinfoil 호환 위해 URL 특수문자 인코딩(`helpers.js`).
- **세이브 동기화**(`src/modules/ftp-client.js`): `/shop.tfl` 요청 시 스위치 IP를 메모리에 기록 →
  주기적으로 FTP 접속해 `/JKSV`, `/switch/tinfoil/saves`를 `<games>/Saves/`로 다운로드.
  `SAVE_SYNC_INTERVAL < 5000`이면 동기화 중단.

## 4. 소스 구조

```
src/
├── index.js                 # 진입점: express 앱 구성 + 서버 시작
├── shop-file-builder.js     # /shop.json /shop.tfl 미들웨어
├── create-index-content.js  # fast-glob 스캔 → 인덱스 객체 생성
├── staticIndexHTML.js       # serve-index용 커스텀 HTML (인라인 CSS/JS)
├── authUsersParser.js       # AUTH_USERS env → {user:pass} 파싱
├── afterStartFunction.js    # 시작 시 로컬/공인 IP, 버전 로깅
├── package.js               # package.json 읽어 버전 노출
├── debug.js                 # debug 네임스페이스(tinfoil-hat:*)
├── helpers/
│   ├── envs.js              # 모든 ENV → 설정값 (경로/포트/인증/메시지)
│   └── helpers.js           # 경로/URL 인코딩 유틸, 템플릿 로더
└── modules/
    ├── ftp-client.js        # SaveSyncManager (FTP 세이브 백업)
    └── ip-search.js         # LAN 디바이스 스캔 (현재 미사용으로 보임)
```

## 5. 환경 변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `ROMS_DIR_FULLPATH` | `<repo>/games/` | 서빙할 게임 폴더 (컨테이너=`/games`) |
| `TINFOIL_HAT_PORT` | `80` | 리슨 포트 |
| `AUTH_USERS` | 없음 | `user:pass,user2:pass2` — basic auth (없으면 인증 비활성) |
| `UNAUTHORIZED_MSG` | "No tricks and treats for you!!" | 인증 실패 메시지 |
| `WELCOME_MSG` | 없음 | shop 성공 메시지 |
| `SAVES_BACKUP_PATH` | `<games>/Saves/` | 세이브 저장 경로 |
| `JSON_TEMPLATE_PATH` | `<repo>/shop_template.jsonc` | shop 템플릿 |
| `NX_PORTS` | `5000` | 스위치 FTP 포트 |
| `NX_IPS` | 없음 | 스위치 IP (`;` 구분) |
| `NX_USER` / `NX_PASSWORD` | 없음 | FTP 자격 |
| `SAVE_SYNC_INTERVAL` | `5000` | 세이브 동기 주기(ms), `<5000`이면 중단 |
| `DEBUG` | `tinfoil*` | 로그 네임스페이스 |

## 6. Rebuild 시 정리/개선 대상

### 원본 잔재 (제거/치환 필요)
- `docker-compose.yml`: 이미지명 `vinicioslc/tinfoil-hat`, Windows 호스트 경로
  `c:/Users/vinic/Downloads/...`, ko-fi 등 원작자 종속 값.
- `README.md`: 원작자 배지/링크/스크린샷, Docker Hub 네임스페이스.
- `package.json`: `author`, `repository`, `homepage`, `bugs`, `d:publish*` 스크립트가 원작자 Docker Hub push.
- GitHub Actions `docker.yml`: Docker Hub(`DOCKER_USERNAME/PASSWORD`)로 push → 내 레지스트리로 교체.

### 기술 부채 / 위험
- **Node 버전 3중 불일치**: Dockerfile node19(EOL) / volta node16 / 로컬 node24. LTS로 통일 필요.
- `node:19-alpine3.16` 베이스는 EOL — 보안 업데이트 없음.
- `preinstall: npx playwright install` 가 **프로덕션 `npm install`에도 실행** → 컨테이너에 불필요한
  브라우저 다운로드(이미지 비대/빌드 실패 위험). 분리 필요.
- 컨테이너가 **root로 실행**, WORKDIR=`/` (루트에 앱 전체 복사) — non-root 유저 + `/app` 권장.
- `COPY . /` 가 `.dockerignore`(`.env`, `node_modules`만 제외) 기준 — `.git`, `test`, `.github`,
  `.diagrams` 등도 이미지로 들어감. dockerignore 강화 필요.
- 멀티스테이지 빌드 아님 → 이미지 크기 큼.
- healthcheck 없음.
- `ip-search.js`의 IP 범위 `192.168.0.2-192.168.0.192` 하드코딩(현재 호출부 없음 → 사용처 확인 후 정리).
- `serve-index`의 `hidden:false` 주석과 실제 동작 검토(README는 dotfile 숨김 의도).

### 보안 참고 (의도된 용도 내)
- Basic Auth는 평문 비교(HTTPS 미적용 시 노출). LAN 전용 의도지만 공인 IP 로깅/노출됨.
- `AUTH_USERS`를 compose에 평문 — `.env`/시크릿으로 분리 권장.

## 7. 결정된 Rebuild 방향 (사용자 선택)

- 이미지 레지스트리: **GHCR** (`ghcr.io/<내-깃허브-계정>/tinfoil-hat`)
- 게임 경로: **`./games`** (프로젝트 내부 마운트)
- Dockerfile: **전체 현대화** (최신 LTS Node, 멀티스테이지, non-root, dockerignore 강화, healthcheck)
