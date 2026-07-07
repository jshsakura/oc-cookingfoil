# PLAN — Device Pairing + Layered Auth

> Status: **DESIGN LOCKED (pending final ack)** · 2026-07-07
> Supersedes the earlier "pending-approval, no app change" sketch and the
> "zero-approval id/password" detour. This is the agreed target.

## 1. 목적

친구가 **비밀(URL·비번)을 건네받지 않고**, 자기 콘솔의 **공개 기기키(QR)만** 넘겨서
접근 권한을 얻는다. 관리자는 모바일에서 그 기기키를 승인만 한다. 이후 접근은
**서버가 그 기기 전용으로 발급한 키**로 이뤄진다 → "가타부타 없이 자연스럽게 접근."

핵심 명제(사용자 원문): *"내 정보를 서버에 주고 그걸로 요청하고, 그게 등록돼 있으면
동작하고 아니면 그냥 연결 안 되는 것."*

## 2. 인증 3레인

| 레인 | 클라이언트 | 주 인증 | 폴백(옵션) | 비고 |
|---|---|---|---|---|
| 웹 대시보드/관리자 | 브라우저(폰/PC) | **Google SSO** | 기존 TOTP 세션 | 브라우저 O → OAuth 정상 |
| CyberFoil | 스위치(우리 제어) | **기기 페어링(무비번)** | basic-auth | 페어링 미구현 빌드는 폴백 |
| Tinfoil | 스위치(폐쇄) | **basic-auth** | — | OAuth·페어링 불가 → 비번 옵션 **필수 유지** |

> **왜 클라이언트 SSO는 안 하나:** 스위치엔 브라우저/웹뷰가 없어 Google OAuth
> 리다이렉트 불가. 유일한 길인 OAuth device-flow는 아래 페어링과 사실상 같은 모양
> → 클라에 Google을 얹는 건 중복. SSO는 대시보드 전용. (YAGNI)

## 3. 페어링 프로토콜

### 용어
- **deviceKey (기기키, ↑올라감)** — `SHA-256(eMMC CID)`, 64 hex 대문자. 콘솔 하드웨어
  지문. CyberFoil `util/uid.hpp::ComputeUidFromMmcCid()` 가 이미 계산·전송 중(`UID:` 헤더).
  - ⚠️ eMMC 읽기 실패 시 `000…0`(64개 0)로 폴백 → **절대 승인·통과 금지**(전 기기 공유값).
- **accessKey (발급키, ↓내려옴)** — 승인 시 서버가 난수 생성(≥32B, base64url). 서버는
  **해시만 저장**, 원문은 발급 응답 1회만 노출. 기기가 저장 후 매 요청에 제시. 비번 대체.

### 상태전이 (deviceKey 기준)
```
(없음) --pair/request--> PENDING --admin approve--> APPROVED(+accessKey 발급)
                             |                           |
                          admin reject               admin revoke
                             v                           v
                          (삭제)                       (삭제, accessKey 무효)
```

### 엔드포인트 (서버, 이 레포)
| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `POST /api/pair/request` | 없음(공개) | body `{deviceKey, label?}` → PENDING 기록, `{status:"pending"}` |
| `GET /api/pair/status?deviceKey=` | 없음(공개) | PENDING→`{status:"pending"}` / APPROVED→`{status:"approved", accessKey, shopUrl}` (accessKey는 **첫 승인 직후 1회만** 원문 반환, 이후엔 재발급 필요) |
| `GET /api/admin/devices` | 관리자 세션 | `{approved:[…], pending:[…]}` |
| `POST /api/admin/devices/approve` | 관리자 세션 | `{deviceKey, label}` → APPROVED + accessKey 생성 |
| `POST /api/admin/devices/revoke` | 관리자 세션 | `{deviceKey}` → 삭제, accessKey 무효 |

### 요청 시 인증 (deviceAuthGuard)
- CyberFoil 콘텐츠 요청 헤더: `UID: <deviceKey>` + `X-Access-Key: <accessKey>`(신규, 앱 작업).
- 가드: `deviceKey` 형식검증(64hex·비제로) → APPROVED이고 `hash(accessKey)` 일치 → 통과,
  그 외 403. 미승인 deviceKey는 PENDING에 기록(대시보드 노출).

## 4. 서버 데이터 모델 (store.js 확장, state.json)
```
devices:  Map<deviceKey, { label, addedAt, addedBy, accessKeyHash, lastSeenAt, lastIp, lastVersion }>
pending:  Map<deviceKey, { firstSeenAt, lastSeenAt, count, lastIp, lastVersion }>
```
- 기존 failures/lockouts/access/audit 옆에 추가, 동일 debounced flush·atomic write 재사용.

## 5. 하위호환 / 안전 스위치
- `COOK_DEVICE_PAIRING` (기본 **false**) — 켤 때만 `/api/pair/*` + pairingGate +
  deviceContentGuard 활성. 업그레이드로 기존 사용자 안 잠김.
- basic-auth(authGuard)·Tinfoil 경로는 그대로. 페어링은 **추가(OR) 레인**이지 교체 아님.
  요청은 basic-auth **또는** 페어링 중 하나만 통과해도 됨.
- **운영자 구성(확정): 페어링 단독.** `COOK_AUTH_USERS` 비움 + `COOK_DEVICE_PAIRING=true`
  → `deviceContentGuard`가 콘텐츠 표면을 승인 기기로만 잠금(="접속정보 있어도 아무나
  못붙음"). basic-auth 코드는 남아 남들(틴포일)이 켜면 동작.
- 가드 배치: `pairingGate`는 authGuard 앞(통과 시 basic-auth 스킵). `deviceContentGuard`는
  shopFileBuilder+static 앞, `/admin`·`/api/*`·landing 은 미접촉. 관리자 세션 쿠키/loopback 예외.

## 6. 페이징
- **Phase 1 (서버, 이 레포) — ✅ 완료:** store 확장(devices/pending) + `/api/pair/*` +
  pairingGate + deviceContentGuard + authGuard 스킵 + `/admin/api/devices*`(list/approve/
  revoke) + 대시보드 "Devices" UI + `COOK_DEVICE_PAIRING` env + 단위테스트(7/7). 기본 off.
  스모크: request→pending, all-zero 거부, approve는 TOTP surface 뒤(404 when off) 확인.
- **Phase 2 (CyberFoil, 별도 레포) — 다음:** 도메인만 입력 UI, deviceKey QR 표시,
  `pair/request`+`status` 폴링, accessKey 저장, `X-Access-Key` 전송. → 여기서 **end-to-end
  실기 검증**(그 전엔 "완성" 아님).
- **Phase 3 (SSO, 대시보드):** Google OAuth(웹) 관리자 로그인, TOTP 폴백 유지.

## 8. Phase 2 클라이언트 계약 (실제 앱 `../oc-cookfoil-sdl`, SDL/libnx)

> ⚠️ 앞선 초안은 구 CyberFoil(Plutonium) 기준이라 폐기. 진짜 앱은 처음부터 새로 짠
> SDL 코드베이스(`TARGET=oc-cookfoil` → `.nro`, git remote 없음 → 빌드는 사용자 GitHub
> CI(nightly=main push, release=v태그/PR) 또는 로컬 devkitPro). **이 환경선 컴파일 불가.**

### 헤더 (단일 초크포인트)
- `source/network/ShopAuth.cpp::buildCfHeaders(auth)` — 앱 fetch + 엔진 설치 요청 **둘 다**
  여길 통과. 여기에 값 있을 때만 추가:
  `X-Device-Key: <deviceKey>` / `X-Access-Key: <accessKey>` (CF 토큰 가드 밖에).
- `net::ShopAuth`(`include/network/HttpClient.hpp:17`)에 `deviceKey`/`accessKey` 필드 추가,
  `ShopProfile::auth()`(`ShopProfile.hpp:31`)에서 채움.

### deviceKey (이미 링크됨)
- `inst::util::ComputeUidFromMmcCid()`(핀된 엔진 `third_party/CyberFoil/source/util/uid.cpp`,
  Makefile:60로 이미 .nro에 포함) = eMMC CID→SHA256 64hex. `#ifdef __SWITCH__` 가드, 호스트는
  placeholder. → 서버 `deviceKeyFromHeaders`가 이 64hex를 그대로 받음(정렬 완료).

### 프로필 저장 (accessKey)
- `ShopProfile`(`include/ui/shop/ShopProfile.hpp:16`)에 `accessKey` 필드 + 코덱
  (`ShopProfileCodec.cpp` 13-18/54-65/88-95에 key 상수+addStr/getStr). parse는 tolerant라
  구버전 config 호환.

### QR ("몰래 담기" — 최소 노출)
- QR 라이브러리 없음 → Nayuki `qrcodegen`(MIT, 단일 .c) vendoring. `source/utils/` 등
  globbed 디렉토리에 두면 자동 빌드(신규 subdir면 Makefile:29 `SOURCES`에 추가). 12MiB
  예산 여유 ~1.85MiB.
- 렌더: QR 매트릭스→`SDL_Surface`→`SDL_CreateTextureFromSurface`(패턴 `TextureCache.cpp:51`).
  64hex 텍스트 노출 X, **QR 이미지 하나만**.

### UI/상태 (단일 클래스 상태머신)
- `ui::shop::ShopScreen` `enum Screen{List,Editor,Shop,Queue}`(`ShopScreen.hpp:137`). 신규
  `Screen::Pairing` 값 + 서브스크린 멤버 + `show…()` 세터. 스레드 없음 → **폴링은
  `ShopScreen::update()`(매 프레임, `main.cpp:197`)에서 프레임카운터로 rate-limit**.

### 상태머신
```
연결 시도 → deviceKey 계산 → POST {url}/api/pair/request {deviceKey} → Screen::Pairing(QR)
update() 폴링(≈3~5s, 지수백오프): GET {url}/api/pair/status?deviceKey=
   pending             → QR 유지
   approved + accessKey → ShopProfile.accessKey 저장 → 폴링종료 → 정상 연결
   approved (키 없음)   → 이미 페어링됨/키소진 → 관리자 Re-issue 안내
이후: 저장된 (X-Device-Key + X-Access-Key)로 shop/다운로드. 403 → 재페어링/Re-issue.
```

### CI 주의
- `nightly.yml:39`/`release.yml:42,49`가 산출물명을 `oc-save-keeper.nro`로 잘못 참조(실제는
  `oc-cookfoil.nro`) → 업로드 스텝 깨져 있음. 앱 작업 김에 같이 고칠 것.

## 7. 미해결 / 결정 필요
- [ ] accessKey 회전·만료 정책(무기한 vs TTL). 초안: 무기한 + 관리자 revoke.
- [ ] 계정↔기기 다대다 허용? 초안: deviceKey 단독 식별(계정 개념과 분리).
- [ ] Phase 3 Google OAuth 클라이언트/도메인 준비(콜백 URL, GCP 프로젝트).
- [ ] `pair/status` 폴링 남용 방지(rate-limit 재사용 + PENDING TTL).
