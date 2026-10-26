import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The fields of a Switch item as the three assembly sites hand them out: the file list and sections
// (create-index-content.js), the detail (title-detail.js) and the name and icon of a patch's or a
// save's game (game-info.js). One library covers each way a value can be found: titledb alone, the game
// file's own title alone, a file title that outranks titledb's, an admin's text, and nothing at all.
// The output is compared with test/golden/item-fields.json, taken before the sites shared one merge, so a
// change of where a value comes from shows here first. Where the sites differ from each other the golden
// keeps the difference as it is. GOLDEN_UPDATE=1 rewrites it, only for a change meant to alter a value.

const GOLDEN = path.join(import.meta.dirname, "..", "golden", "item-fields.json");

const A = "0100000000A01000"; // titledb only, in three languages
const B = "0100000000B02000"; // the game file only
const C = "0100000000C03000"; // titledb has Japanese only, the file has a Korean title
const D = "0100000000D04000"; // titledb, and the admin's name and description over it
const E = "0100000000E05000"; // nothing knows it
const G = "0100000000F06000"; // titledb in English only, the file has an English title

const PROBE = `
  import * as store from "../../src/meta/titledb-store.js";
  import * as extractedMeta from "../../src/meta/extracted-meta-store.js";
  import * as gameMeta from "../../src/meta/game-meta.js";
  import * as customArt from "../../src/meta/custom-art.js";
  import { composeSections, composeResponse } from "../../src/create-index-content.js";
  import { titleDetail } from "../../src/meta/title-detail.js";
  import { gameOf } from "../../src/meta/game-info.js";
  await store.load();
  await extractedMeta.load();
  await customArt.init();
  await gameMeta.scan({ force: true });
  const files = new Map();
  for (const rel of JSON.parse(process.env.GOLDEN_FILES)) files.set(rel, { url: "../" + encodeURIComponent(rel), name: "", size: 1, mtime: 1728000000 });
  const sections = composeSections(files, []);
  const list = composeResponse(files, []);
  const ids = JSON.parse(process.env.GOLDEN_IDS);
  const detail = {};
  for (const id of ids) {
    detail[id] = {
      unasked_ko: await titleDetail(id, { lang: "ko", asked: null }),
      en: await titleDetail(id, { lang: "en", asked: "en" }),
      ko: await titleDetail(id, { lang: "ko", asked: "ko" }),
      ja: await titleDetail(id, { lang: "ja", asked: "ja" }),
    };
  }
  const games = Object.fromEntries(ids.map((id) => [id, gameOf(id, "")]));
  process.stdout.write(JSON.stringify({ sections, files: list.files?.map((f) => ({ url: f.url, name: f.name })) ?? null, detail, games }));
`;

function fixture(root) {
  const data = path.join(root, "data");
  const games = path.join(root, "games");
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  mkdirSync(path.join(data, "extracted-meta"), { recursive: true });
  mkdirSync(games, { recursive: true });
  const put = (file, body) => writeFileSync(path.join(data, ...file.split("/")), JSON.stringify(body));
  put("titledb/US.en.json", {
    a: { id: A, name: "Alpha Quest", publisher: "Alpha Studio", description: "An English description of Alpha.", releaseDate: 20230501, category: ["Adventure", "Action"], rating: 12, numberOfPlayers: 2, languages: ["en", "ko"], aliases: ["Alpha Quest"], region: "US" },
    d: { id: D, name: "Delta Run", publisher: "Delta Works", description: "Delta from titledb.", releaseDate: 20220101, category: ["Racing"] },
    g: { id: G, name: "Gamma Ray", publisher: "Gamma Inc", description: "Gamma from titledb.", releaseDate: 20210301 },
    u: { id: "0100000000A01800", name: "Alpha Quest Update" },
    x: { id: "0100000000A01001", name: "Alpha Quest Booster Pack", publisher: "Alpha Studio" },
  });
  put("titledb/KR.ko.json", {
    a: { id: A, name: "알파 퀘스트", publisher: "알파 스튜디오", description: "알파의 한국어 설명입니다.", releaseDate: 20230601, aliases: ["Alpha Quest"] },
  });
  put("titledb/JP.ja.json", {
    c: { id: C, name: "ガンマの冒険", publisher: "ガンマ", description: "ガンマの日本語の説明。", releaseDate: 20200101 },
  });
  put(`extracted-meta/${B}.json`, { id: B, name: "Beta Homebrew", publisher: "Beta Dev", description: "Read from the file.", releaseDate: 20190101, size: 1234, source: "nacp" });
  put(`extracted-meta/${C}.json`, { id: C, name: "감마의 모험", publisher: "감마", source: "nacp" });
  put(`extracted-meta/${G}.json`, { id: G, name: "Gamma Ray Deluxe", publisher: "File Publisher", source: "nacp" });
  const admin = path.join(data, "metadata", "games", `Delta Mine [${D}]`);
  mkdirSync(admin, { recursive: true });
  writeFileSync(path.join(admin, "game.json"), JSON.stringify({ id: D, name: { ko: "델타 달리기", en: "Delta Mine" }, description: { ko: "관리자가 쓴 설명입니다.", en: "Written by the admin." }, notes: "Install with the update." }));
  const rels = [
    `Alpha Quest [${A}][v0].nsp`, "Alpha Quest Update [0100000000A01800][v65536].nsp", "Alpha Quest Booster Pack [0100000000A01001][v0].nsp",
    `Beta Homebrew [${B}][v0].nsp`, `Gamma [${C}][v0].nsp`, `Delta [${D}][v0].nsp`, `Mystery [${E}][v0].nsp`, `Gamma Ray [${G}][v0].nsp`, "Homebrew.nro",
  ];
  for (const rel of rels) {
    writeFileSync(path.join(games, rel), "x");
    utimesSync(path.join(games, rel), 1728000000, 1728000000);
  }
  return { data, games, rels };
}

test("the fields of an item come out of the three sites as the golden file has them", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cook-field-golden-"));
  try {
    const { data, games, rels } = fixture(root);
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_EXTRACT_ICONS: "off", COOK_LANG_PRIORITY: "ko,en,ja", GOLDEN_FILES: JSON.stringify(rels), GOLDEN_IDS: JSON.stringify([A, B, C, D, E, G]) },
      encoding: "utf-8",
      timeout: 30000,
    });
    const actual = JSON.parse(out);
    if (process.env.GOLDEN_UPDATE === "1") {
      mkdirSync(path.dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    assert.deepEqual(actual, JSON.parse(readFileSync(GOLDEN, "utf8")));
    // The golden file is only worth something if the fixture reaches every source.
    const items = Object.fromEntries(actual.sections.sections[0].items.map((i) => [i.title_id ?? i.name, i]));
    assert.equal(items[A].name.startsWith("알파 퀘스트"), true, "titledb's Korean name");
    assert.equal(items[B].name, "Beta Homebrew", "the file's name when titledb has none");
    assert.equal(items[C].name.startsWith("감마의 모험"), true, "a Korean title in the file over titledb's Japanese one");
    assert.equal(actual.detail[D].unasked_ko.descriptionCustom, true, "the admin's text");
    assert.equal(actual.detail[E].unasked_ko, null, "nothing known at all");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
