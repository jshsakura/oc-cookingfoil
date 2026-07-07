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

## 8. Phase 2 클라이언트 계약 (CyberFoil, `../CyberFoil`)

서버(Phase 1)는 확정. 앱은 아래만 구현하면 end-to-end 완성 — **턴키 규격:**

### 저장 (영속 config)
- 기존 `inst::config::remoteUrl/remoteUser/remotePass` 옆에 **`remoteAccessKey`** 추가.
- `remoteUser/remotePass`는 페어링 모드에선 빈 값 허용(무비번).

### 헤더 (한 지점만 수정)
- `source/util/curl.cpp::buildRemoteHeaders()` — 이미 `UID:`(=deviceKey) 전송 중.
  여기에 **`X-Access-Key: <remoteAccessKey>`** 한 줄 추가(값 있을 때만). deviceKey는
  `util/uid.hpp::ComputeUidFromMmcCid()` 그대로.

### 온보딩 UI (remoteInstPage / remoteInstall.cpp)
1. **도메인만 입력** 모드(아이디/비번 칸 옵션화). 값 예: `cook.example.com` 또는 `1.2.3.4:9080`.
2. **기기키 QR 표시** — `ComputeUidFromMmcCid()` 결과(64hex)를 QR로. (QR 렌더 라이브러리
   필요 — 현재 CyberFoil엔 없음. 경량 C QR 인코더 vendoring.)
3. **페어링 상태머신:**
   ```
   POST {domain}/api/pair/request  {deviceKey}         → 대기 화면 진입
   loop: GET {domain}/api/pair/status?deviceKey=...     (3~5s 간격, 지수백오프)
         status=="pending"   → 계속 폴링 (QR 화면 유지)
         status=="approved" && accessKey 있음
             → remoteAccessKey=accessKey, remoteUrl=shopUrl 저장 → 폴링 종료 → 접속
         status=="approved" && accessKey 없음(이미 수령분 소진)
             → 이미 페어링됨. 키 없으면 관리자에게 "Re-issue" 요청 안내
   ```
4. 이후 일반 접속: 저장된 `remoteUrl` + (UID + X-Access-Key) 헤더로 shop/다운로드.
   403 오면 "기기 미승인/키 만료" 안내 → 재페어링 or Re-issue.

### 폴링 예절
- `pair/status`는 공개+rate-limited. 지수 백오프(예: 3→5→8s, 상한 15s), 화면 벗어나면 중단.

## 7. 미해결 / 결정 필요
- [ ] accessKey 회전·만료 정책(무기한 vs TTL). 초안: 무기한 + 관리자 revoke.
- [ ] 계정↔기기 다대다 허용? 초안: deviceKey 단독 식별(계정 개념과 분리).
- [ ] Phase 3 Google OAuth 클라이언트/도메인 준비(콜백 URL, GCP 프로젝트).
- [ ] `pair/status` 폴링 남용 방지(rate-limit 재사용 + PENDING TTL).
