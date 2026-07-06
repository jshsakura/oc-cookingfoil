# CookingFoil — 경량 원격 샵 클라이언트 (확정 플랜)

> 상태: **구현 착수됨 (H1 호스트 하니스 완료 — UI가 헤드리스 호스트서 실제 렌더·스크린샷 검증됨. 다음 M3.5)** · 갱신 2026-07-06
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
- ✅ **M2b** 카드 그리드 + 박스아트 (커밋 6ea85ef, 9.68MB, 호스트테스트 237). `ui::shop::GridLayout`(순수·불변) + `net::httpGet`(curl GET DRY 추출) + `IconCache`(실패캐시, 프레임당 2로드상한, 스레드無). D-pad/스틱/방향키 내비.
- ✅ **M2c** 마스터-디테일 (커밋 c7aebd9, **9.29MB** ←DRY통합으로 −0.39, 호스트테스트 **251**). ①`base_title_id`로 base+upd+dlc **그룹핑**(`ui::shop::TitleGroup::groupTitles` 순수, out-of-order base promotion, 호스트테스트9) ②A선택→상세모달(`net::parseTitleDetail`+`fetchTitleDetail`, 스샷 캐러셀 L/R, 호스트테스트5) ③설치범위 토글 X=upd·Y=dlc(기본 둘다ON)+"will install" 요약. `IconCache`→**`TextureCache`**(git mv, url키, icon/banner/스샷 공용) + `ShopRender`(팔레트·draw/wrap 헬퍼 추출, ShopScreen/DetailPanel 공유). **Queue/Install/SD⇄NAND=로그스텁(M4/M5), 엔진 미연결.** fetch/decode는 하드웨어 없어 빌드검증만.
- ✅ **M3** 연결 UI + 프로필저장 (커밋 34aec7f, 9.31MB, 호스트테스트 **262**). `net::normalizeShopUrl`(순수, 스킴없으면 https prepend·authority검증·트레일링슬래시strip, 호스트테스트11) + `ShopProfile`(SettingsStore `shop.url/user/pass`) + `ConnectScreen`(swkbd 입력·호스트는 `COOK_SHOP_URL` env폴백·실패시 에러표시). 부팅시 저장URL 있으면 자동연결. **Minus=서버변경**. 선택 basic-auth를 httpGet/fetch에 스레딩. 상세 리치화(category/rating/intro 렌더). swkbd/fetch는 빌드검증만.
- ✅ **M4a** 엔진 seam (커밋 c554d96, 9.32MB, 호스트테스트 262). CyberFoil **서브모듈** `third_party/CyberFoil`@eaf0353(1.4.5, 리모트 clone 성공) + `nx/`·`install/`(usb제외)·util·data 컴파일(예외 per-object ON). **`engine-shim`이 예상보다 작음**: 헤더 2개만 섀도잉(`ui/instPage.hpp`·`ui/MainApplication.hpp`), `pu::String` 불필요, instPage 14 + mainApp `CreateShowDialog`(std::string) + `_lang` identity + 링커가 노출한 `tin::network::HTTPDownload/HTTPHeader`·`inst::offline::TryGetMetadata` no-op 스텁(M4b가 실 network_util/offline_title_db로 대체). +`-lzstd -lmbedtls*`. 크기 미증가=`--gc-sections`가 미참조 엔진 스트립(진단 `--no-gc-sections`로 tin/inst 미해결 0 확인=**100% 링크**). M4b에서 설치버튼이 참조하면 진입.
- ✅ **H1** 호스트 런타임 하니스 (커밋 664f6be + CJK폰트 34b9bfd, 호스트테스트 262, .nro 9.32MB). `make host`→네이티브 `oc-cookfoil-host`(SDL2+ttf+image+curl), **헤드리스 offscreen 렌더→PNG**. 픽스처(`host/fixtures/sections.json`+`title-*.json`) 결정론 렌더 + 라이브 `--url`. 호스트 네트워크 `COOKFOIL_HAVE_CURL` 매크로 개방(유닛테스트 순수유지). `ShopScreen::loadCatalogFromJson`/`injectDetailJson` 주입 seam. **스크린샷 실검증됨**: 그리드(6그룹, 선택하이라이트, +N upd·N dlc 뱃지)·상세(배너·메타·캐러셀·범위칩·설치요약·버튼) 목업대로 렌더. **한글**=호스트폰트를 NotoSansCJK로(두부 해결, 커밋 34b9bfd). **엔진 설치(libnx)만 온디바이스, UI/browse/detail/connect/net/parse는 호스트 실검증.** → **이후 모든 클라 워커는 H1 하니스로 스크린샷 시각검증할 것.**
- 다음(클라 master 순차): **M3.5** 다중샵+CF(§10) → **M4b** 설치배선(§9.1) → **M5** 큐/일괄/NAND → **M6** oc아이콘·i18n.

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

- **글루 seam**: 아래 §9 참조 — `http_nsp` 1파일이 아니라 `install/*.cpp` 전반의 진행/다이얼로그 레이어. shim 하나로 흡수.
- **예외 플래그**: Tinfoil 엔진 C++ 예외 사용 → 설치 TU는 예외 켜서 빌드(save-keeper 기본 `-fno-exceptions`와 분리).
- **미결정**: 클라 앱 이름(`oc-cookfoil` 잠정). ~~서브모듈 vs 벤더링~~ → **서브모듈로 결정**(§9, CyberFoil GitHub 리모트 확인). ~~sections 리치필드~~ → **완료**(a4f9ac0).
- 관련 메모리: [[cyberfoil-native-sections-endpoint]] [[lean-shop-client-plan]] [[public-base-url-scheme-footgun]]

---

## 9. M4 엔진 통합 — seam 정찰 결과 (2026-07-06, CyberFoil v1.4.5 실사)

**진입점**: `remoteInstStuff::installTitleRemote(const std::vector<RemoteItem>& items, int storage, const std::string& sourceLabel)` (`source/remoteInstall.cpp:2410`, 헤더 `include/remoteInstall.hpp`). `storage`=NcmStorageId(SD/NAND). 우리 [＋큐]/[설치] 버튼이 선택그룹→`RemoteItem` 벡터 만들어 호출.

**`RemoteItem`은 우리 `net::ShopItem`과 사실상 1:1** (`name·url·iconUrl·appId·size·titleId(u64)·appVersion·releaseDate·appType(int)` + has* 플래그; `save*` 필드는 save_sync용=무시). 매핑 어댑터 1개면 됨.

**결합 지형 (핵심)**:
- **`source/nx/` = Plutonium 결합 0** (`content_meta·fs·nca_writer(NCZ/zstd)·ncm·ipc/`) → **무수정 as-is 컴파일**. 딥 암호화/NCA쓰기/NCM등록 = 그대로 흡수.
- **`source/install/*.cpp` = 대부분 결합** (http_nsp/xci·install·install_nsp/xci·sdmc_nsp/xci·usb_nsp/xci 가 `inst::ui::instPage::*`·`inst::ui::mainApp->CreateShowDialog`·`"..."_lang` 호출). **usb_\* 는 드롭**(경량). 나머지는 shim에 대고 컴파일.
- `remoteInstall.cpp`(2520줄, 결합 36곳)는 오케스트레이터 — 통째 흡수 대신 `installTitleRemote` 경로에 필요한 부분만 + shim.

**shim 표면 (우리가 공급할 비-Plutonium 대체 심볼 — 엔진 무수정 컴파일용)**:
1. `inst::ui::instPage` 정적 15개: `setTopInstInfoText·setInstInfoText·setInstBarPerc(double)·setProgressDetailText·clearProgressDetailText·setInstallIconFromTitleId·setInstallIcon·setInstallIconData·clearInstallIcon·loadMainMenu·loadInstallScreen·requestInstallCancel·isInstallCancelRequested·clearInstallCancel` → **우리 SDL2 설치진행 화면 상태**로 라우팅(진행바 %, 상세텍스트, 취소플래그).
2. `inst::ui::mainApp->CreateShowDialog(String Title, String Content, vector<String> Options, bool UseLastOptionAsCancel, string Icon) → int` + **최소 `pu::String` 스탠드인** → SDL2 확인 다이얼로그(선택 인덱스 반환); 헤드리스 기본선택.
3. `"..."_lang` user-defined literal → **최소 로컬라이제이션 shim**(키 또는 en 매핑 반환).

**빌드**: CyberFoil Makefile = `-fno-rtti -std=gnu++20`, 예외 사용(=`-fno-exceptions` 없음). 우리 Makefile은 `nx/`+`install/`(usb 제외) 소스를 예외 켜서 컴파일 + shim 헤더 경로. **CyberFoil = git 서브모듈 핀**(`github.com/luketanti/CyberFoil.git`, 1.4.5) → `submodule update --remote`로 업스트림 흡수.

**M4 분할(권장)**:
- **M4a — 엔진 seam**: CyberFoil 서브모듈 핀 + `nx/`·`install/`(usb제외) 컴파일 + `engine-shim/`(instPage/mainApp/pu::String/`_lang` 최소구현, 진행콜백은 일단 no-op/log) → **빌드 그린**(동작無). 엔진이 우리 트리에서 링크됨을 실증.
- **M4b — 설치 배선**: SDL2 설치진행 화면 + shim이 그 화면으로 라우팅 + `ShopItem`→`RemoteItem` 어댑터 + [설치] 버튼→`installTitleRemote(items, SD, ...)`. **SD 설치 경로**만(NAND는 M5). 하드웨어 없어 빌드검증 + 로직 유닛테스트 한도.

**리스크**: `pu::String`/`_lang`/`instPage` 재현이 M4의 실난이도(엔진이 Plutonium 헤더를 얼마나 transitively 당기는지에 따라 shim 표면이 커질 수 있음 — M4a에서 실측). 업스트림 리팩터 시 shim 수리.

### 9.1 M4b 착수 준비 — `installTitleRemote` 흐름 실사 (remoteInstall.cpp:2410-2518)

전체 시퀀스: `initInstallServices()` → `instPage::loadInstallScreen()` → `destStorageId = storage ? BuiltInUser : SdCard`(**0=SD, 1=NAND**) → diag `StartSession` → (overclock config) → **basic-auth**: `inst::config::remoteUser/remotePass` 비어있지않으면 `tin::network::SetBasicAuth(user,pass)` → **item 루프**: `UpdateInstallIcon` + `setTopInstInfoText` + XCI판별(`IsXciExtension(name|url)||IsXciMagic(url)`) → XCI면 `InstallXciHttpStream(url, storage)`, NSP면 `HTTPNSP(url)`+`NSPInstall(storage, ignoreReqVers, httpNSP)` → `Prepare()`+`Begin()`(진행은 `HTTPNSP::StreamToPlaceholder`가 `instPage::setInstBarPerc/setProgressDetailText`로 구동) → diag record → catch(std::exception)→실패 다이얼로그 → 성공시 `CreateShowDialog` 완료 → `instPage::loadMainMenu()` → `deinitInstallServices()`.

**M4b 설계 결정 (권장): `installTitleRemote`를 통째 흡수하지 말 것.** 그 함수는 `remoteInstall.cpp`(결합 36곳: `inst::config/diag/util`, `_lang`, `mainApp`, 오디오 romfs `bark.wav`/`success.wav`, `std::thread` 오디오, overclock)에 있어 통째 끌어오면 결합을 상속. **대신 M4a가 컴파일한 딥 설치클래스(`tin::install::nsp::HTTPNSP`/`NSPInstall`, `InstallXciHttpStream`)를 우리 네임스페이스의 얇은 오케스트레이터(~60줄, 위 시퀀스의 핵심만: init→루프[HTTPNSP+NSPInstall+Prepare/Begin]→deinit)가 직접 구동.** 진행 콜백은 우리 SDL2 설치진행 화면으로. "우리가 소유하는 건 글루+프론트뿐"(§1) 정신에 부합, `_lang`/오디오/overclock 등 불필요 결합 회피.

**M4b shim 라우팅 실체(no-op→실동작)**: `loadInstallScreen`/`loadMainMenu`=우리 설치화면 push/pop, `setInstBarPerc(double)`=진행바 0-100, `setInstInfoText`/`setTopInstInfoText`/`setProgressDetailText`=상태텍스트 3줄, `setInstallIcon*`=박스아트(초기 no-op 허용), `isInstallCancelRequested`=B/취소 플래그. **basic-auth 배선**: M3의 `shop.user/pass`를 `inst::config::remoteUser/remotePass`(또는 우리 오케스트레이터가 직접 `tin::network::SetBasicAuth`)로. **M4b=SD경로만**(storage=0), NAND=M5.

**미확정(M4a 결과 대기)**: `NSPInstall`/`HTTPNSP` 생성자·`Prepare`/`Begin` 시그니처가 깨끗이 컴파일되는지, `initInstallServices`/`deinitInstallServices`가 어느 파일(util)이고 얼마나 결합됐는지 — M4a의 shim 실측이 M4b 오케스트레이터 표면을 확정.

---

## 10. M3.5 — 다중 샵 프로필 + Cloudflare Access (신규 요구, 사용자 2026-07-06)

> M3(단일 프로필)의 확장. **클라 repo(`master`) — ConnectScreen/ShopProfile 수정 → M4a 착지 후 순차 실행**(같은 repo 커밋 레이스 방지). 사용자 확정: CF는 **Access 서비스 토큰**(Client-Id+Client-Secret 쌍).

**요구**: 설정 메뉴에서 **여러 샵을 등록/관리**(주소·아이디·비밀번호 입력해 전환) + 각 샵에 **Cloudflare Access 서비스 토큰**을 넣어 CF Zero Trust 뒤의 샵을 더 안전하게 통과.

**데이터 모델** — `ShopProfile`(M3)을 리스트로 확장. 프로필 필드: `label`(표시명)·`url`·`user`·`pass`(선택 basic-auth)·`cfClientId`·`cfClientSecret`(선택 CF Access). 저장: `SettingsStore`(플랫 json)에 프로필 벡터를 **json 배열 문자열로 직렬화**해 `shops` 키 + `shops.selected` int(setInt). SettingsStore API 변경 없이 ShopProfile 모듈이 json-c로 `loadProfiles()/saveProfiles(vector)` 담당(KISS).

**HTTP 배선(중요)** — `net::httpGet`은 M3에서 optional `userpwd`(basic-auth) 받음. **CF 헤더 2개**(`CF-Access-Client-Id`/`CF-Access-Client-Secret`) 추가 = curl `CURLOPT_HTTPHEADER`. **모든 샵 요청에 실려야 함**: sections·title detail **+ TextureCache의 아이콘/배너/스크린샷 프록시**(CF Access 뒤면 아트워크도 403 나므로 필수). 즉 연결 인증(basic+CF)을 **세션 컨텍스트**(`net::ShopAuth{userpwd, cfId, cfSecret}`)로 묶어 sections/detail/텍스처 페치 전부에 전달. M2b/M2c의 TextureCache 페치 경로가 현재 auth를 안 받으면 이 컨텍스트를 받도록 확장.

**UI** — M3 `ConnectScreen`을 2레벨 설정으로: ①**샵 리스트**(선택/추가/편집/삭제, 현재 연결 표시) ②**프로필 편집기**(label/url/user/pass/cfId/cfSecret 필드, swkbd 입력, Connect/Save). 그리드의 Minus=설정 진입. 선택 프로필로 연결.

**보안 주의(알려진 한계)**: Switch 홈브류 SD는 비암호화 → `settings.json`에 pass·CF secret **평문 저장**(M3의 pass도 동일). 진짜 보안은 불가; 난독화는 가능하나 홈브류에선 형식적. 플랜/메모리에 한계로 명시. (CF Access 자체는 전송구간을 CF가 강제하므로, "샵을 공개 basic-auth로 여는 것보다 안전"이라는 요구는 충족.)

**호스트 테스트 대상**: 프로필 직렬화/역직렬화(json 라운드트립), CF 헤더 조립 로직(순수). fetch/swkbd는 빌드검증만.

**마일스톤 순서 갱신**: M4a(진행) → **M3.5(다중샵+CF, 클라 master 순차)** → M4b(설치배선) → M5 → M6. (M3.5를 M4b보다 먼저: 설정/연결 계층이라 M4a와 같은 repo 순차슬롯에 자연스럽게 들어감. 단 M4b가 급하면 순서 교체 가능 — 둘 다 M4a 뒤 순차.)
