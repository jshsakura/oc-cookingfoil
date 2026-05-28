# 메타데이터/아이콘 미표시 — 근본 원인 분석 (코드 증거 기반)

> 결론: **서버(tinfoil-hat) 쪽 문제**. 현재 서버가 클라이언트가 기대하는 필드를 내보내지 않음.

## 1. 현재 서버가 실제로 내보내는 것 (실측)

`test/project/games`로 `shop.json` 생성한 실제 출력:

```json
{
  "files": [
    { "url": "../...%5B010010401BC1A000%5D%5Bv0%5D...nsz", "size": 5 },
    { "url": "../...%5B010010401BC1A800%5D%5Bv65536%5D...nsz", "size": 5 }
  ],
  "directories": [ "../...%5BNSZ%5D" ]
}
```

- `titledb` **없음**, 각 파일에 `name` **없음**, `icon_url`/`iconUrl` **없음**.
- 제공하는 건 `url`(전부 percent-encoded) + `size`뿐.

## 2. 클라이언트(CyberFoil/AeroFoil)가 기대하는 스키마 (코드 증거)

`CyberFoil/source/shopInstall.cpp::AppendShopItemFromEntry()` (라인 1507~1636):

각 파일 엔트리에서 읽는 필드:
- 다운로드 URL: `url` | `path` | `file` | `download_url` | `downloadUrl`
- `size`
- **`name`** — 있으면 사용, 없으면 URL `#fragment`, 그것도 없으면 URL에서 추론 → `ApplyLegacyMetadataFromName()`로 파일명에서 타이틀ID 등 파싱
- **`icon_url`** 또는 **`iconUrl`** — 아이콘 이미지 URL
- 세이브 관련: `save_id`, `note`, `created_at`, `created_ts` 등

### 아이콘 핵심 로직 (라인 1627~1633)

```cpp
if (!item.hasIconUrl && !inst::config::shopLegacyMode) {
    if (TryResolveBaseTitleId(item, baseTitleId) && baseTitleId != 0) {
        item.iconUrl = BuildFullUrl(baseUrl, "/api/shop/icon/" + FormatTitleIdHexUpper(baseTitleId));
        item.hasIconUrl = true;
    }
}
```

→ `icon_url`이 응답에 없으면(비-legacy 모드) 클라이언트는 **서버의 `GET /api/shop/icon/<TITLEID>` 엔드포인트로 아이콘을 요청**한다.
다운로드/캐시: `shopInstall.cpp:568~622` (`shop_icons` 캐시, basic-auth 지원).

## 3. 근본 원인 (확정)

| 증상 | 원인 |
|------|------|
| **이미지 안 나옴** | 서버가 `icon_url`을 안 줌 → 클라가 `/api/shop/icon/<titleid>` 요청 → **서버에 그 엔드포인트 없음(404)** → 아이콘 없음 |
| **메타데이터 전부 못 끌어옴** | 서버가 `name`/`titledb`를 안 줌 → 클라가 파일명만으로 추론 → 파일명 규칙 안 맞거나 정보 부족 시 비어 보임. 표준 Tinfoil은 온라인 titledb/CDN 의존이라 오프라인 LAN에선 더 비어 보임 |

추가 확인:
- 클라이언트는 `sections`(섹션형 응답), `files`(배열/객체 둘 다), `paths`, `directories`(재귀 fetch)도 지원 → 서버가 풍부한 응답을 줄 여지가 큼.
- 표준 Tinfoil은 아이콘을 자체 온라인 CDN(타이틀ID 기반, 인터넷 필요)에서 가져옴 → 순수 오프라인 LAN 샵에선 안 나옴. CyberFoil은 이를 `/api/shop/icon/` 서버 엔드포인트 + 로컬 `offline_db`로 해결.

## 4. 수정 방향 (서버측)

1. **각 파일 엔트리에 `name`, `size`, `icon_url` 추가** — 깨끗한 게임명 + 아이콘 URL.
2. **`GET /api/shop/icon/:titleId` 엔드포인트 구현** — 타이틀ID로 아이콘 반환(캐시).
   - 아이콘 소스 후보:
     a. NSP/XCI 내부 컨트롤 NACP/아이콘 추출(키 필요, 정확)
     b. 공개 titledb/이미지 소스에서 타이틀ID로 받아 캐시(인터넷 1회 필요)
     c. 사용자가 넣어둔 로컬 아이콘 폴더
3. **`titledb`(또는 per-item 메타) 생성** — 파일명에서 타이틀ID 파싱 → titledb 데이터로 name/publisher/size/desc 채움 → 오프라인에서도 완전 표시.
4. **성능**: 매 요청 `fast-glob` 전체 스캔 → 결과 캐시 + 변경 감지(watch)로 개선.

## 5. 확정 설계 (Phase 2 구현)

### 아이콘 소스
**NSP/XCI 내부 NACP 추출** (오프라인 100%). `prod.keys`는 볼륨 마운트만, 이미지에 미포함.
파이프라인: 파일 스캔 → titleID 식별 → NACP/icon 추출 → `data/extracted/<titleid>.{json,jpg}` 캐시.

### 메타데이터 소스 — 2층 + 머지/폴백
**L1 (로컬, 권위)**: NACP 다국어 16개 슬롯 (한국어 포함). 파일 자체가 출처.
**L2 (외부, 보강)**: blawar/titledb의 여러 region/lang JSON을 **합집합으로 머지**:
- `titles.KR.ko.json`, `titles.US.en.json`, `titles.EU.en.json`, `titles.JP.ja.json`, `titles.HK.zh.json`
- 머지 키: titleID 대문자 16-hex.

### 언어/지역 누락 방지 (필드별 폴백 체인)
> 한 region 파일에만 의존하지 않음. 어디든 한 곳에 있으면 채워짐.

각 필드는 다음 우선순위로 첫 번째 발견값을 채택:

```
[NACP language slots in user preference order]
  Korean → AmericanEnglish → BritishEnglish → Japanese → Chinese* → ...
[titledb region files, merged]
  titles.KR.ko → titles.US.en → titles.EU.en → titles.JP.ja → titles.HK.zh
[filename parsing]
  fallback (only for name + titleID + version)
```

핵심 규칙:
- 머지는 **per-field** — name은 ko에서, description은 en에서 가져올 수 있음.
- 어떤 region 파일에도 없는 타이틀이라도, NACP가 있으면 그대로 표시됨.
- 사용자 언어 선호도는 env(`COOK_LANG_PRIORITY=ko,en,ja`)로 설정 가능.

### shop.json 응답 형태 (CyberFoil/AeroFoil 호환)
```jsonc
{
  "files": [
    {
      "url": "../<encoded>.nsp",
      "name": "<localized name>",            // L1/L2 폴백 결과
      "size": <bytes>,
      "icon_url": "/api/shop/icon/<TITLEID>" // 또는 정적 캐시 URL
    }
  ],
  "directories": [...],
  "titledb": {
    "<TITLEID>": { "id":..., "name":..., "publisher":..., "description":..., "releaseDate":..., "region":..., "rating":..., "rank":..., "size":... }
  }
}
```

### 엔드포인트 추가
- `GET /api/shop/icon/:titleId` — `data/extracted/<titleid>.jpg` 또는 placeholder 반환 (basic-auth 적용).
- (선택) `POST /admin/refresh-titledb` — titledb 캐시 강제 갱신.

### 성능
- 현재: 매 요청 fast-glob full scan. → **파일 캐시 + chokidar로 변경 감지** 기반 incremental refresh.
- 추출 결과(`data/extracted/`)는 영구 캐시 — 같은 파일은 재추출 안 함(파일 mtime/size 해시로 키).

### NSZ/XCZ 지원 (필수)
- 대상: `.nsp`, `.xci`, `.nsz`(NSP 압축), `.xcz`(XCI 압축) 동등 처리.
- 방식: 이미지에 Python `nsz` 도구 번들(이미지 +~50MB).
- 파이프라인: 추출 전 임시 디렉터리(`/tmp/cf-decompress/<hash>`)에 NSP/XCI로 decompress → NACP/icon 추출 → 임시 파일 즉시 삭제.
- 캐시 키는 원본 NSZ 파일의 mtime/size 해시 — 한 번 추출되면 NSZ 자체에 대해 재추출 안 함.

### 임의 항목(custom entries) 지원 — 팬/홈브류/레거시 콘텐츠용
> CyberFoil 코드상 `url`+`name`만 있어도 항목으로 push됨 → 서버가 자유 항목 머지 가능.
> 예: **Just Dance Legacy** 같은 fan-made/modded 콘텐츠, 홈브류 NRO, 합성 ID를 쓰는 컬렉션.

- **파일**: `custom_entries.jsonc` (게임 폴더 루트 또는 `COOK_CUSTOM_ENTRIES` env로 경로 지정).
- 형식: 배열. 필수=`url`+`name`, 선택=`size`, `titleId`(합성 가능), `iconPath`/`iconUrl`, `publisher`, `description`, `releaseDate`, `region`, `rating`, `rank`.
- 머지 규칙: 파일 스캔 결과의 `files[]`에 append, `titleId`가 있으면 `titledb`에도 등록.
- **titleID 정책**:
  - 공식 Nintendo 영역(`01XX...`) 그대로 허용.
  - 합성 ID도 그대로 허용 — Nintendo 미사용 prefix(`09FF...`, `0FFF...`) 권장하지만 강제 X.
  - **ID의 "정합성" 검사로 항목을 떨어뜨리지 않는다** (필터링 금지).
- 로컬 아이콘: `iconPath`(서버 호스트의 상대/절대 경로)는 `/api/shop/icon/<titleId 또는 hash>`로 자동 노출.
- titleID 없는 항목도 합법 — 그룹화/풍부 표시 못 받을 뿐, 리스트에는 정상 등장.

## 6. "샵 = 파일 + 메타 한 덩어리" 원칙

> 기존 샵: 로그인 → `shop.json`(파일 URL 리스트)만. 메타데이터는 클라이언트가 별도 출처(온라인 CDN, 자체 titledb)에서 가져와 매핑.
> CookingFoil: 로그인 한 번 → **파일 + 메타 + 아이콘 참조까지 한 응답에 통째로**.

설계 결정:

1. **`shop.json` = fat manifest**
   - `files[]` 각 항목에 `name`, `size`, `icon_url` 포함.
   - 같은 응답에 `titledb` 통째로 포함(쿼리 1회로 모든 메타 확보).
   - 다국어 머지·custom entries 결과도 동일 응답에 반영.

2. **균일 인증 게이트**
   - basic-auth는 `shop.json`/`shop.tfl`뿐 아니라 **파일 다운로드, `/api/shop/icon/:titleId`, custom entries 응답에도 동일 적용.**
   - "shop.json만 보호하고 파일은 익명 다운로드" 같은 비대칭을 만들지 않는다.

3. **(선택) `/api/shop/bundle`** — 운영 편의를 위한 단일 dump 엔드포인트.
   - 응답: `shop.json` 내용 + 아이콘 매니페스트(타이틀ID→URL 또는 base64) + titledb 버전 정보.
   - 사용처: 클라이언트의 "오프라인 동기화" 한 방, 운영자의 백업.

4. 클라이언트 호환성
   - 표준 Tinfoil: `files`/`titledb`만 읽음 → 그대로 동작.
   - CyberFoil/AeroFoil: 위에 + `name`/`icon_url`/`/api/shop/icon` 추가 활용 → 더 풍부하게 표시.
   - 양쪽 모두 한 응답으로 만족시키도록 superset 스키마 유지.

## 7. 누락 0 원칙 (Hard Invariant)

> 어떤 게임이든 — titleID 파싱 실패, NACP 추출 실패, titledb 미수록, NSZ 압축 풀기 실패, 합성ID, 외부 URL, 팬메이드 — **무조건 `files[]`에 들어간다.**

구현 가드레일:
1. 메타 추출은 **enrichment**일 뿐, **gating이 아니다.** 추출 실패 = `name`이 파일명 그대로일 뿐, 항목 누락 아님.
2. 키 없거나 prod.keys 미구비 환경 → 메타·아이콘 비어 있을 뿐, 다운로드 가능한 항목으로 그대로 노출.
3. titledb 모든 region 파일이 비어/없어도 → NACP만으로, 그것도 없으면 파일명만으로 표시.
4. titleID "유효성"(체크섬·길이·Nintendo prefix)으로 **거르지 않는다**. 합성/팬메이드 ID 그대로 통과.
5. custom_entries.jsonc 파싱 실패시 → 그 항목만 skip + 로그, 다른 항목 영향 없음.

체크리스트 (Phase 2 PR 머지 직전 검증):
- [ ] prod.keys 없는 환경에서 모든 `.nsp/.xci/.nsz` 파일이 shop 리스트에 등장 (메타 비어도 OK)
- [ ] titledb 캐시 비운 상태에서도 모든 파일 등장
- [ ] 합성 titleID(`09FF000000000000`) 항목이 정상 표시
- [ ] titleID 없는 항목(`{ "url": "...", "name": "..." }`)이 정상 표시
- [ ] 파일명에서 titleID 못 뽑는 항목(예: `random.nsp`)도 정상 표시

