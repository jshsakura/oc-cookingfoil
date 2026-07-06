# CookingFoil — 경량 원격 샵 클라이언트 (확정 플랜)

> 상태: **구현 착수됨 (M2b 완료, M2c 진행 예정)** · 갱신 2026-07-06
> 한 줄: **CyberFoil 설치 엔진만 훔쳐오고, 프론트는 save-keeper(SDL2) 골격으로 새로. 상대는 틴포일.**

---

## 현황 & 이어가기 (다음 세션은 여기부터)

**서버 (oc-cookingfoil) — 사실상 완료, GHCR `latest`=v0.7.26 배포됨 (미릴리스 커밋 a4f9ac0 있음):**
- `/api/shop/sections`(캐시+압축+ETag) · `/api/title/:id`(리치상세) · icon/banner/screenshot 프록시
- NACP폴백·한(영) titledb백필 · 대시보드 모달 상세부활+캐시 · **대시보드 eShop-린 개편(v0.7.26)**
- ✅ **sections 행 리치필드 인라인** (커밋 a4f9ac0, 미릴리스): `base_title_id`(그룹핑 키 — M2c가 base+upd+dlc 묶는 근거) + `publisher`(titledb→NACP폴백) + `region`. 커스텀행도 통과. 유닛테스트 28개 통과.
- 남은 것(선택): WebP 프록시(sharp) · oc-scraper식 확장(트레일러/평점) · **v0.7.27 릴리스 범프**(a4f9ac0 아직 릴리스 안 함 — 사용자 판단)

**클라 (`oc-cookfoil-sdl/`, save-keeper SDL2 fork) — 브랜치 `master`(main 아님!) — 마일스톤 진행:**
- ✅ **M0** 리브랜드 빌드 확증 (10.0MB, 커밋 3690509)
- ✅ **M1** 우리 `ui::shop::ShopScreen` 부팅 (9.24MB, 커밋 60465eb). save 도메인은 dead code로 트리에 둠.
- ✅ **M2a** `net/ShopClient`: curl fetch `/api/shop/sections` + json-c 파서 + 호스트유닛테스트(231) + 텍스트목록 (9.58MB, 커밋 18b3d11).
- ✅ **M2b** 카드 그리드 + 박스아트 (커밋 6ea85ef, 9.68MB, 호스트테스트 237). `ui::shop::GridLayout`(순수·불변, 호스트테스트 6) + `net::httpGet`(curl GET DRY 추출) + `ui::shop::IconCache`(iconUrl→IMG_Load_RW→텍스처, 실패캐시, 프레임당 2로드상한, 스레드無). D-pad/스틱/방향키 내비. **A선택=로그스텁(M2c 대기), 그룹핑無(M2c).** fetch/decode는 하드웨어 없어 빌드검증만.
- 다음: **M2c 마스터-디테일** = ①`base_title_id`로 base+upd+dlc **그룹핑**(서버 a4f9ac0가 키 제공) ②A선택→우측 **상세패널**(`/api/title/:id`: desc/스샷/배너/publisher) ③설치범위 토글(upd/dlc 기본ON) 목업대로. → **M3** 상세 리치화 → **M4** 엔진통합(CyberFoil 설치엔진 서브모듈+`http_nsp` 진행글루 SDL2 재작성) → **M5** 큐/일괄/NAND/SD토글 → **M6** oc아이콘·메모리하니스·i18n.

**UI 청사진(목업, 실기 없이 확인용)**: Artifact `https://claude.ai/code/artifact/bd89b180-68c4-4912-b1b9-34ad5f47b458`
(1280×720 eShop 마스터-디테일: 좌 그리드 + 우 상세(배너·박스·스샷·메타·설치범위토글·SD/NAND·큐/설치) + 하단 컨트롤러힌트 + Catppuccin+CRT). **M2~M5가 이 목업을 SDL2로 구현.** 소스: scratchpad/cookfoil-client-mockup.html.

**빌드 명령 (스위치)**: `cd oc-cookfoil-sdl && docker run --rm -e DROPBOX_APP_KEY=dummy -e DROPBOX_BRIDGE_BASE=https://example.invalid -v "$PWD":/work -w /work devkitpro/devkita64 bash -lc 'make -j4'` → oc-cookfoil.nro. (save-keeper Makefile이 DROPBOX 키 요구 → 더미, M1+에서 제거 예정. .env는 gitignore.)
**호스트 테스트**: `make test` (build-host, 스위치 불필요 — 파서 등 순수로직 검증용. 실기 없어 런타임은 이걸로 커버).

**주요 디렉토리**:
- `oc-cookfoil-sdl/` = **진짜 클라** (SDL2). `oc-cookfoil/` = 구 Plutonium 실험(대체됨, 참고만). `CyberFoil/` = 엔진 도너(v1.4.5). `oc-save-keeper/` = 골격 소스. `oc-scraper/` = 형제(리치메타/캐시 패턴 참조).

**실기 없음** → 클라는 빌드검증 + 호스트유닛테스트 + 목업기준으로 진행. 런타임 확인은 하드웨어 확보 시.

---

## 0. 핵심 결정 (사용자 확정 2026-07-06)

1. **상대는 틴포일, 사이버포일 아님.** CyberFoil은 "단일설치 + 전 파일 나열"이라 UI/UX는 쓰레기 → **버림.**
   우리 목표 = 틴포일급(그룹·일괄설치·리치) **이상**.
2. **CyberFoil = 엔진 도너일 뿐.** 설치 엔진(nx/·install/, UI무관 Adubbz 코어)만 기증받고 UI/디자인은 안 씀.
3. **UI 토대 = save-keeper (순수 SDL2), NOT Plutonium.** Plutonium은 SDL2 위 레이어(libpu)+오디오스택이라 무거움
   (스트립된 CyberFoil 13.51MB vs save-keeper ~10MB, ~3MB↓). "가벼워야 빠르다" → **SDL2 확정.**
4. **역할**: 클라 = **원격 설치 + 다운로드 큐**만. 나머지 다 버림.
5. **디자인**: 우리 웹(Catppuccin Mocha) 감성 + oc 브랜드. save-keeper 인프라(Paths·SettingsStore·i18n·Logger·Docker/`make test`) 재사용.
6. **엔진 흡수**: 엔진을 분리 의존성으로 핀 → CyberFoil 업스트림 엔진 개선을 나중에 흡수("훔쳐오기 좋게").

---

## 1. 아키텍처 — 3계층

| 계층 | 출처 | 비고 |
|---|---|---|
| **UI 골격** (재사용) | **save-keeper (순수 SDL2)** | main 루프·화면스택·GridMenu·SettingsStore(json-c)·i18n·Logger·Paths·Docker/`make test` Makefile |
| **설치 엔진** (재사용, 무수정) | CyberFoil `source/nx/*`, `source/install/*`, `http_nsp`, `NSPInstall`/`XCIInstallTask`, `installTitleRemote` | 순수 libnx, UI 무관. Adubbz 정통 코어. **서브모듈 핀 → update로 흡수** |
| **진행률 글루** (재작성, 유일한 실작업) | 우리가 새로 | `http_nsp.cpp::StreamToPlaceholder`가 지금 Plutonium `instPage::setInstBarPerc`/`mainApp->CreateShowDialog` 직접 호출 → **우리 SDL2 UI 콜백으로 교체** (≈1파일). + 설치 TU는 예외플래그 켜야 함(엔진이 C++ 예외 사용) |
| **프론트** (신규) | 우리가 새로 | **SDL2** 커스텀 UI, Catppuccin, oc. 아래 기능 |

**엔진 흡수(훔쳐오기) 방식**: CyberFoil을 git 서브모듈로 핀 → 우리(save-keeper 기반) Makefile이 엔진 소스만 컴파일 → 우리 쪽 얇은 `inst::config`/progress shim 공급. 업스트림 개선 = `git submodule update --remote` + shim 수리. **딥 엔진(암호화/NCA쓰기/NCM등록/NCZ)은 안정적이라 그대로 흡수**, 우리가 소유하는 건 글루+프론트뿐.

> M0/M1(Plutonium fork, 13.51MB) 실험은 **엔진이 독립 빌드·strip 가능함을 실증**한 값어치. SDL2 경로에서 그 엔진을 그대로 씀. 폐기 아님.

---

## 2. 클라 기능 (프론트 신규 구현)

- **원격 연결**: URL + (선택)유저/패스, 프로필 저장.
- **브라우즈**: `/api/shop/sections` 페치 → **Catppuccin 카드 그리드/리스트**.
- **그룹핑**: base + update + DLC를 base 하나로 묶어 표시 (`groupTitleId` 기준). 틴포일식.
- **리치 행**: 아이콘 한 장이 아니라 **이름 · 버전 · 용량 · 타입 · 퍼블리셔**.
- **상세 패널**: 타이틀 선택 시 `/api/title/:id` 페치 → **설명 · 스크린샷 캐러셀 · 배너 · 평점 · 인원**.
- **다운로드 큐**: 여러 타이틀 담아 **순차 설치**. `installTitleRemote(vector)`가 이미 순차라 큐는 UI 누적 레이어.
- **일괄설치**: 그룹(base+upd+dlc) 한 번에 = 벡터에 담아 엔진 호출.
- **설치**: SD / NAND. i18n en/ko만.

### 2.1 화면 인터랙션 (마스터-디테일, 확정)

좌: 게임 목록(그리드/리스트, base 그룹). 우: 상세 패널.
- **A로 게임 선택 → 우측 상세 패널** 채움: `/api/title/:id` 페치 → 배너 + **스크린샷 캐러셀** + 이름/퍼블리셔/연도/인원/설명.
- 상세 하단 **설치 범위 토글**: `[✓] 업데이트 vX 포함`, `[✓] DLC(N개) 포함` (그룹핑으로 확보한 그 게임의 upd/dlc).
  **기본값 = 둘 다 ON(자동선택)** → 게임 선택 시 base+upd+dlc 전부 체크 상태(기본 "전부 설치"), 해제하면 base만.
- **[＋ 큐]** = base + 체크된 upd/dlc를 벡터로 큐에 누적. **[설치]** = 그 벡터를 `installTitleRemote`로 순차설치.
- 토글 OFF → 벡터에서 제외. 즉 "base만" ~ "전부" 자유 선택.
- **설치 위치 토글 (SD ⇄ NAND)**: 기본 SD, 헤더/풋터 상주(1회 설정 유지) + 설치/큐 확정 시 대상 표시.
  엔진 `installTitleRemote(items, storage, ...)`의 `storage`(NcmStorageId: SdCard/BuiltInUser)로 전달 — 엔진 기지원.
  큐는 선택 시점 위치로 순차설치(항목별 override는 후순위).


---

## 3. 서버(oc-cookingfoil) 측 — 이미 대부분 완료

| 항목 | 상태 |
|---|---|
| `/api/shop/sections` 네이티브 섹션 (캐시+압축+ETag) | ✅ v0.7.19~22 |
| `/api/title/:baseTitleId` 온디맨드 리치 상세 (desc/screenshots/publisher…) | ✅ v0.7.23 |
| NACP 폴백 이름, titledb 지역 백필(한(영)) | ✅ v0.7.20~ |
| **sections 행에 리치필드 인라인**(base_title_id/publisher/region/release_date) | ✅ 커밋 a4f9ac0 (base_title_id 그룹핑키 + publisher + region + 기존 release_date, 경량) |
| icon/banner/screenshot 프록시 | ✅ 기존 |

→ 서버는 새 클라가 필요로 하는 계약을 **다 제공**. `base_title_id`까지 내보내므로 M2c 그룹핑은 서버 추가작업 없이 클라만 구현하면 됨. (남은 서버작업=선택: v0.7.27 릴리스 범프, WebP 프록시.)

---

## 4. 경량화 (CyberFoil 대비 제거 대상)

제거: **MTP**(mtp_install/server + `external/libhaze`), **USB/HDD**(usbInstall/hddInstall + `include/libusbhsfs`), **net install**(netInstall), **save_sync**, **오프라인DB 자동업데이트**(offline_db_update + main.cpp 스레드), **다국어 9종**(en/ko만). 
효과: **~1.5–3MB↓ .nro** + 빌드 빨라짐. (Makefile은 dir glob이라 `.cpp` 삭제 시 자동 제외; libhaze/libusbhsfs만 Makefile 라인 정리)
**유지 필수**: remoteInstall 경로, `nx/`·`install/` 엔진, curl/network_util/auth, config, install_diagnostics, title_util(GetBaseTitleId), instPage(진행), sdInstall.

---

## 5. 브랜딩 (oc 패밀리)

`TARGET=oc-cookfoil`(잠정), `APP_TITLE="OC CookFoil"`, `APP_AUTHOR="OpenCourse"`, oc 메인 아이콘으로 `icon.png`. Catppuccin Mocha 팔레트 + Zen Tokyo Zoo/버터 모티프. `application.json` hbmenu 매니페스트. CyberFoil 문구/이미지/룩 전부 교체.

---

## 6. 메모리 하니스 (경량 검증)

- **정적**: `.nro` 크기 예산 게이트(CI, 상한 초과 시 실패) — strip 효과 추적.
- **런타임**: libnx `svcGetInfo`로 힙/가용 로깅(디버그 HUD) — 스트립 빌드가 예산 내인지 실측.

---

## 7. 마일스톤

1. **M0 엔진 seam 확정**: CyberFoil 서브모듈 핀 + 컴파일할 엔진소스 목록 + `http_nsp` 진행글루 교체 지점 문서화.
2. **M1 스캐폴드**: 새 Plutonium 앱 + 엔진 링크 + 빈 화면 첫 `.nro` 빌드.
3. **M2 브라우즈**: sections 페치 + Catppuccin 리치 그리드 + 그룹핑.
4. **M3 상세**: `/api/title/:id` 상세 패널(스크린샷/배너).
5. **M4 설치+큐**: 엔진 연결(글루 교체) → SD 설치 → 큐/일괄.
6. **M5**: NAND, 메모리 하니스, oc 브랜드/아이콘, i18n 마감.

---

## 8. 리스크 / 미결

- **글루 seam**: `http_nsp` 진행/다이얼로그를 우리 UI로 교체 — 유일한 실질 결합 지점. 업스트림이 이 파일 리팩터 시(이전 shop→remote 전례) shim 수리 필요.
- **예외 플래그**: Tinfoil 엔진 C++ 예외 사용 → 우리 앱도 예외 켜서 빌드.
- **미결정**: 클라 앱 이름(`oc-cookfoil` 잠정), 서브모듈 vs 벤더링, sections 리치필드 범위.
- 관련 메모리: [[cyberfoil-native-sections-endpoint]] [[lean-shop-client-plan]] [[public-base-url-scheme-footgun]]
