import { test } from "node:test";
import assert from "node:assert/strict";

import { addUrlEncodedFileInfo } from "../../src/helpers/helpers.js";

// 상대 경로 하나를 와이어 URL 로 인코딩한다.
const enc = (relPath) => addUrlEncodedFileInfo({ url: relPath }).url;

// ── 회귀: 목록에는 보이는데 받으면 깨지던 파일들 ──────────────────────────
//
// 예전 구현은 `url.parse(p).path` 뒤에 손으로 만든 치환표를 돌렸다. 그 표에
// `?` 와 `#` 이 없어서 그런 이름을 가진 파일이 shop.json 에는 정상으로 실리고
// 실제 요청에서만 404 가 났다. 실측 라이브러리에서 11건.

test("물음표를 %3F 로 인코딩한다 (예전엔 리터럴로 남아 404)", () => {
  const got = enc("What The Golf?/What The Golf? [01002C000E35E000][v0].nsp");
  assert.equal(
    got,
    "What%20The%20Golf%3F%2FWhat%20The%20Golf%3F%20%5B01002C000E35E000%5D%5Bv0%5D.nsp"
  );
  assert.ok(!got.includes("?"), "리터럴 ? 가 남으면 쿼리스트링으로 잘린다");
});

test("샵 이름 그대로 요청해도 원본 경로로 복원된다", () => {
  const names = [
    "Is This Potato?/Is This Potato? [0100A51026A8C000][v0].nsp",
    "Is What Youre Looking For Summer?/x [0100000000000000][v0].nsp",
    "Choice Clash What Would You Rather?/x [0100000000000000][v0].nsp",
  ];
  for (const n of names) assert.equal(decodeURIComponent(enc(n)), n);
});

test("샵 이름에 # 이 있어도 뒷부분이 잘리지 않는다", () => {
  // url.parse 는 # 을 프래그먼트 구분자로 보고 뒤를 통째로 버렸다:
  //   "Test #Hash/Test #Hash [x].nsp" → "Test%20"
  const got = enc("Test #Hash/Test #Hash [0100000000000000][v0].nsp");
  assert.ok(got.includes("%23"), "# 는 %23 이어야 한다");
  assert.equal(
    decodeURIComponent(got),
    "Test #Hash/Test #Hash [0100000000000000][v0].nsp"
  );
});

test("리터럴 % 를 %25 로 인코딩한다", () => {
  const got = enc("100% Orange Juice/100% Orange Juice [x].nsp");
  assert.ok(got.startsWith("100%25%20Orange"), got);
  assert.equal(decodeURIComponent(got), "100% Orange Juice/100% Orange Juice [x].nsp");
});

test("꺾쇠도 인코딩한다 (Daemon X Machina DLC)", () => {
  const got = enc("Daemon X Machina/DLC/Set <Missile> [0100CB8005B2700A][v0].nsp");
  assert.ok(got.includes("%3C") && got.includes("%3E"), got);
});

// ── 기존 와이어 포맷 유지 ───────────────────────────────────────────────────

test("기존 포맷을 그대로 유지한다 — / 는 %2F, 괄호와 대괄호도 인코딩", () => {
  assert.equal(
    enc("(Deutsch) Pokemon/(Deutsch) Pokemon [0100FD6023430000][v0].nsp"),
    "%28Deutsch%29%20Pokemon%2F%28Deutsch%29%20Pokemon%20%5B0100FD6023430000%5D%5Bv0%5D.nsp"
  );
  assert.equal(
    enc("Normal Name/Normal Name [0100000000000000][v0].nsp"),
    "Normal%20Name%2FNormal%20Name%20%5B0100000000000000%5D%5Bv0%5D.nsp"
  );
});

test("비ASCII 는 UTF-8 퍼센트 인코딩한다", () => {
  // 예전에는 날것으로 나갔다. 서버는 양쪽 다 받지만 날것은 URI 로서 유효하지
  // 않고, 특히 U+00A0 은 공백처럼 보여 클라이언트마다 다르게 해석될 수 있다.
  assert.equal(decodeURIComponent(enc("Pokémon Shield/x.nsp")), "Pokémon Shield/x.nsp");
  assert.ok(enc("Pokémon Shield/x.nsp").includes("%C3%A9"));
  assert.ok(enc("Defense Master/x.nsp").includes("%C2%A0"));
});

test("모든 출력이 디코딩 왕복을 통과한다", () => {
  const samples = [
    "A/B.nsp",
    "What The Golf?/a.nsp",
    "Test #1/a.nsp",
    "100%/a.nsp",
    "A&B/a.nsp",
    "Sid Meier’S Civilization VI/a.nsp",
    "Set <Missile>/a.nsp",
    "back\\slash/a.nsp",
    "semi;colon,comma=equals+plus/a.nsp",
  ];
  for (const s of samples) assert.equal(decodeURIComponent(enc(s)), s);
});

test("빈 값은 그대로 통과한다", () => {
  assert.equal(enc(""), "");
  assert.equal(addUrlEncodedFileInfo({ url: null }).url, null);
});
