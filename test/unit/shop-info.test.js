import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function probe(env) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import route from "../../src/routes/shop-info.js";
    const res = { headers: {} };
    res.header = (k, v) => { res.headers[k] = v; return res; };
    res.json = (body) => { res.body = body; return res; };
    route({}, res);
    process.stdout.write(JSON.stringify(res.body));
  `], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-info-")), ...env },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("shop info lists the optional fields a client may rely on", () => {
  const info = probe({ COOK_DEVICE_PAIRING: "false" });
  assert.equal(info.name, "CookingFoil");
  assert.equal(info.apiVersion, 1);
  assert.match(info.version, /^\d+\.\d+\.\d+/);
  for (const feature of ["item-install-size", "item-required-firmware", "item-version-name", "title-price"]) {
    assert.ok(info.features.includes(feature), feature);
  }
  assert.ok(!info.features.includes("device-pairing"), "pairing is only listed when it is switched on");
  assert.deepEqual(info.contentMeta, { read: 0, pending: 0 });
});

test("shop info lists device pairing when the server offers it", () => {
  assert.ok(probe({ COOK_DEVICE_PAIRING: "true" }).features.includes("device-pairing"));
});
