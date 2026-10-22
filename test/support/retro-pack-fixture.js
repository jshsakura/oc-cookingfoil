import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { packLedger } from "../../src/db/security-stores.js";
import { sevenZipBin } from "../../src/retro/pack-bundle.js";

// Fixtures shared by the retro pack tests: a small 7-Zip bundle laid out like the official one, a server for it, a pack folder and a ledger.
export const bin = sevenZipBin();
export const opts = { skip: bin ? false : "7-Zip is not installed (COOK_7Z_BIN, 7z, 7zz or 7za)" };
export const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-fill-"));

/** An NRO-looking file: "NRO0" at 0x10, then `tag` so each version differs. */
export const nro = (tag) => Buffer.concat([Buffer.alloc(0x10), Buffer.from("NRO0"), Buffer.from(tag)]);

/**
 * A small bundle laid out like the official one, packed with 7-Zip, with the lock and official table that describe it.
 * `files` maps a path inside the archive to its bytes.
 */
export function makeBundle(version, files) {
  const dir = tmp();
  const root = path.join(dir, "src");
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  const archive = path.join(dir, "RetroArch.7z");
  const made = spawnSync(bin, ["a", "-bd", "-y", archive, "."], { cwd: root, stdio: "ignore" });
  assert.equal(made.status, 0, "7-Zip could not make the fixture");
  const bytes = fs.readFileSync(archive);
  const officialFiles = {};
  for (const rel of Object.keys(files)) {
    const m = rel.match(/^retroarch\/cores\/(.+_libretro_libnx\.nro)$/);
    if (m) officialFiles[m[1]] = [sha(files[rel]), files[rel].length];
  }
  const body = files["switch/retroarch_switch.nro"];
  const lock = {
    version,
    bundle: { url: "http://unused.invalid/RetroArch.7z", file: "RetroArch.7z", size: bytes.length, sha256: sha(bytes) },
    paths: {
      body: { from: "switch/retroarch_switch.nro", to: "retroarch.nro", size: body.length, sha256: sha(body), verified: true },
      cores: { from: "retroarch/cores", to: "cores", verified: true },
      dirs: [
        { from: "retroarch/info", to: "info", verified: true },
        { from: "retroarch/assets", to: "assets", verified: true },
        { from: "retroarch/autoconfig", to: "autoconfig", verified: true },
      ],
    },
  };
  const dirsOf = (top) => Object.keys(files).filter((r) => r.startsWith(`retroarch/${top}/`)).map((r) => r.slice(`retroarch/${top}/`.length)).sort();
  const manifest = { version, dirs: { info: dirsOf("info"), assets: dirsOf("assets"), autoconfig: dirsOf("autoconfig") } };
  return { archive, bytes, pack: { lock, official: { version, files: officialFiles }, manifest } };
}

export const files = (tag, extra = {}) => ({
  "switch/retroarch_switch.nro": nro(`body-${tag}`),
  "retroarch/cores/fceumm_libretro_libnx.nro": nro(`fceumm-${tag}`),
  "retroarch/cores/mgba_libretro_libnx.nro": nro(`mgba-${tag}`),
  "retroarch/cores/unused_libretro_libnx.nro": nro(`unused-${tag}`),
  "retroarch/info/fceumm_libretro.info": `display_name = "Nintendo - NES (${tag})"\n`,
  "retroarch/assets/ozone/a.txt": `asset ${tag}\n`,
  "retroarch/autoconfig/hid/pad.cfg": `input_driver = "hid" # ${tag}\n`,
  ...extra,
});

/** Serves `archive` with Range support; `hits` records each request's Range header. */
export async function serve(archive) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const data = fs.readFileSync(archive);
    hits.push(req.headers.range ?? null);
    const m = /^bytes=(\d+)-/.exec(req.headers.range ?? "");
    if (m) {
      res.writeHead(206, { "Content-Range": `bytes ${m[1]}-${data.length - 1}/${data.length}`, "Content-Length": data.length - Number(m[1]) });
      res.end(data.subarray(Number(m[1])));
    } else {
      res.writeHead(200, { "Content-Length": data.length });
      res.end(data);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/RetroArch.7z`, hits, close: () => server.close() };
}

export const GAMES = [
  { core: "fceumm", system: "nes" }, { core: "fceumm", system: "nes" },
  { core: "mgba", system: "gba" },
  { core: "stella", system: "atari2600" },
];

export function world() {
  const dataDir = tmp();
  const packDir = path.join(tmp(), "retroarch");
  fs.mkdirSync(packDir, { recursive: true });
  const store = packLedger({ db: openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS }) });
  return { dataDir, packDir, store, ledger: store.forRoot("test-root") };
}

export const snapshot = (dir) => {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = sha(fs.readFileSync(path.join(dir, r)));
    }
  };
  if (fs.existsSync(dir)) walk("");
  return out;
};

