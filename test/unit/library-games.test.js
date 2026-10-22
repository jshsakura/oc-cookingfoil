import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The search index is built once per library and reused until the library, an admin's name or
// titledb changes. Its own process: the library and data folders are fixed when the modules load.
test("the game index is reused between searches and rebuilt when an admin renames a game or titledb loads", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cook-library-games-"));
  const games = path.join(root, "games");
  const data = path.join(root, "data");
  try {
    mkdirSync(games);
    mkdirSync(path.join(data, "titledb"), { recursive: true });
    writeFileSync(path.join(data, "titledb", "KR.ko.json"), JSON.stringify({
      a: { id: "0100000000010000", name: "원래 이름" },
    }));
    writeFileSync(path.join(games, "Mario [0100000000010000][v0].nsp"), "x");
    writeFileSync(path.join(games, "Other [0100000000020000][v0].nsp"), "x");
    const probe = `
      import assert from "node:assert/strict";
      import * as store from "../../src/meta/titledb-store.js";
      import * as gameDescriptions from "../../src/meta/game-descriptions.js";
      import { gameIndex, findLibraryGames } from "../../src/meta/library-games.js";
      await store.load();
      const first = await gameIndex();
      assert.equal(await gameIndex(), first, "nothing changed: the same index");
      assert.equal((await findLibraryGames("원래")).total, 1);

      gameDescriptions.set("0100000000010000", "name", { ko: "새 이름", en: null });
      const renamed = await gameIndex();
      assert.notEqual(renamed, first, "an admin name rebuilds it");
      const hit = (await findLibraryGames("새 이름")).items[0];
      assert.equal(hit?.titleId, "0100000000010000");
      assert.equal(hit.edited, true, "the admin wrote about it");
      // The titledb name still finds the game after the admin renamed it.
      assert.equal((await findLibraryGames("원래")).items[0]?.titleId, "0100000000010000");
      assert.equal((await findLibraryGames("other")).items[0]?.edited, false);

      await store.load();
      assert.notEqual(await gameIndex(), renamed, "a titledb load rebuilds it");
      console.log("ok");
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: path.dirname(new URL(import.meta.url).pathname),
      env: { ...process.env, COOK_GAMES_DIR: games, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" },
      encoding: "utf8",
    });
    assert.match(out, /ok\s*$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
