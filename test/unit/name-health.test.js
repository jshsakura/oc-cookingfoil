import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictFor, buildNameHealth } from "../../src/meta/name-health.js";

// Name-source verdict logic. Names resolve via titledb (web-fetched) → NACP
// extraction (.nro free; .nsp/.xci need nstool + prod.keys) → filename garbage.
// The verdict tells the operator which source is (not) carrying the load.

// ── verdictFor: the pure core ─────────────────────────────────────────────

test("verdictFor: titledb has titles → ok (extraction irrelevant)", () => {
  assert.equal(
    verdictFor({ titledbTitles: 1200, nspXciCapable: false, nroCapable: false }),
    "ok"
  );
});

test("verdictFor: no titledb but NSP/XCI capable → ok", () => {
  assert.equal(
    verdictFor({ titledbTitles: 0, nspXciCapable: true, nroCapable: true }),
    "ok"
  );
});

test("verdictFor: no titledb, no NSP/XCI, but .nro capable → degraded", () => {
  assert.equal(
    verdictFor({ titledbTitles: 0, nspXciCapable: false, nroCapable: true }),
    "degraded"
  );
});

test("verdictFor: no titledb, nothing extractable → filename-only", () => {
  assert.equal(
    verdictFor({ titledbTitles: 0, nspXciCapable: false, nroCapable: false }),
    "filename-only"
  );
});

test("verdictFor: titles>0 wins even when nothing else works", () => {
  assert.equal(
    verdictFor({ titledbTitles: 1, nspXciCapable: false, nroCapable: false }),
    "ok"
  );
});

// ── buildNameHealth: probe inputs → full object across the matrix ──────────

test("buildNameHealth: titledb populated → ok, capability flags reflect off extraction", () => {
  const nh = buildNameHealth({
    titledbTitles: 500,
    titledbRegions: ["KR.ko", "US.en"],
    mode: "off",
    nstool: true,
    prodKeys: true,
  });
  assert.equal(nh.verdict, "ok");
  assert.equal(nh.titledb.titles, 500);
  assert.deepEqual(nh.titledb.regions, ["KR.ko", "US.en"]);
  assert.equal(nh.extraction.mode, "off");
  // mode off ⇒ nothing extractable regardless of nstool/keys presence
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.extraction.nroCapable, false);
});

test("buildNameHealth: extraction off + no titledb → filename-only (nothing left)", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    titledbRegions: [],
    mode: "off",
    nstool: false,
    prodKeys: false,
  });
  assert.equal(nh.verdict, "filename-only");
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.extraction.nroCapable, false);
});

test("buildNameHealth: mode 'all' but no keys/nstool + no titledb → degraded (.nro still resolves)", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    titledbRegions: [],
    mode: "all",
    nstool: false,
    prodKeys: false,
  });
  assert.equal(nh.verdict, "degraded");
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.extraction.nroCapable, true);
});

test("buildNameHealth: nstool present but keys missing, no titledb → degraded (nro only)", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    mode: "missing",
    nstool: true,
    prodKeys: false,
  });
  assert.equal(nh.verdict, "degraded");
  assert.equal(nh.extraction.nspXciCapable, false);
  assert.equal(nh.extraction.nroCapable, true);
});

test("buildNameHealth: keys present but nstool missing, no titledb → degraded", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    mode: "all",
    nstool: false,
    prodKeys: true,
  });
  assert.equal(nh.verdict, "degraded");
  assert.equal(nh.extraction.nspXciCapable, false);
});

test("buildNameHealth: full keys+nstool, no titledb → ok, nspXciCapable true", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    mode: "all",
    nstool: true,
    prodKeys: true,
  });
  assert.equal(nh.verdict, "ok");
  assert.equal(nh.extraction.nspXciCapable, true);
  assert.equal(nh.extraction.nroCapable, true);
});

test("buildNameHealth: coerces truthy path-ish inputs to booleans", () => {
  const nh = buildNameHealth({
    titledbTitles: 0,
    mode: "all",
    nstool: "/usr/local/bin/nstool",
    prodKeys: "/keys/prod.keys",
  });
  assert.equal(nh.extraction.nstool, true);
  assert.equal(nh.extraction.prodKeys, true);
  assert.equal(nh.extraction.nspXciCapable, true);
  assert.equal(nh.verdict, "ok");
});

test("buildNameHealth: defaults are safe (empty input) → degraded (mode defaults to 'all' ⇒ .nro capable)", () => {
  const nh = buildNameHealth();
  assert.equal(nh.titledb.titles, 0);
  assert.deepEqual(nh.titledb.regions, []);
  assert.equal(nh.extraction.mode, "all");
  assert.equal(nh.extraction.nroCapable, true);
  assert.equal(nh.verdict, "degraded");
});

test("buildNameHealth: non-array regions coerced to []", () => {
  const nh = buildNameHealth({ titledbTitles: 3, titledbRegions: null });
  assert.deepEqual(nh.titledb.regions, []);
});

test("buildNameHealth: surfaces the auto-extract size cap (maxGb)", () => {
  const nh = buildNameHealth({ titledbTitles: 1, maxGb: 4 });
  assert.equal(nh.extraction.maxGb, 4);
  // 0 = unlimited; a missing/garbage cap coerces to 0
  assert.equal(buildNameHealth({ maxGb: 0 }).extraction.maxGb, 0);
  assert.equal(buildNameHealth().extraction.maxGb, 0);
});
