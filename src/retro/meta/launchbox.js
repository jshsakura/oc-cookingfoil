/**
 * LaunchBox's Metadata.zip read for game details rather than ratings: every
 * game on the wanted platforms (rated or not), its alternate names and its
 * screenshots, out of Metadata.xml; and the arcade set table out of Mame.xml.
 * Both are streamed line by line. Unlike the rating reader, an element may run
 * over several lines (an Overview with paragraphs).
 */
import readline from "readline";
import { decode, titleKey } from "../art/titles.js";
import { SHOT_TYPES } from "./fields.js";

const GAME_FIELDS = ["DatabaseID", "Name", "Platform", "Overview", "Publisher", "Developer", "ReleaseDate", "ReleaseYear", "MaxPlayers", "Genres", "ReleaseType", "CommunityRatingCount", "WikipediaURL", "Cooperative", "ESRB"];
const MAME_FIELDS = ["FileName", "Name", "CloneOf", "Publisher", "Developer", "Year", "Genre", "PlayMode", "Series"];
const BLOCKS = new Set(["<Game>", "<GameAlternateName>", "<GameImage>", "<MameFile>"]);

/** Calls `onBlock(tag, fields)` for every block in an XML stream of LaunchBox's layout. */
async function eachBlock(input, onBlock) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let block = null;
  let cur = {};
  let open = null; // a field whose closing tag is on a later line
  let lines = [];
  for await (const line of rl) {
    if (open) {
      const end = line.indexOf(`</${open}>`);
      if (end < 0) { lines.push(line); continue; }
      cur[open] = decode([...lines, line.slice(0, end)].join("\n"));
      open = null;
      continue;
    }
    const t = line.trim();
    if (BLOCKS.has(t)) { block = t.slice(1, -1); cur = {}; continue; }
    if (block && t === `</${block}>`) { onBlock(block, cur); block = null; continue; }
    if (!block) continue;
    const one = t.match(/^<(\w+)>(.*)<\/\1>$/);
    if (one) { cur[one[1]] = decode(one[2]); continue; }
    const start = t.match(/^<(\w+)>(.*)$/);
    if (start) { open = start[1]; lines = [start[2]]; }
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * { games: Map(id → game), alternates: [[id, name]], images: Map(id → [{ FileName, Type }]) }
 * for the wanted platforms. `openXml()` gives a fresh Metadata.xml stream.
 * With `keys` (titles.js titleKey of every title being looked for) only the
 * games named so, by their name or an alternate name, are kept: that is a
 * thousand-odd games instead of tens of thousands. A game found by an
 * alternate name (which comes after the games in the file) is read in a
 * second pass.
 */
export async function readLaunchBoxMeta(openXml, wanted, keys = null) {
  const games = new Map();
  const onPlatform = new Set();
  const later = new Set();
  const alternates = [];
  const images = new Map();
  const named = (name) => !keys || keys.has(titleKey(name));
  await eachBlock(openXml(), (tag, f) => {
    if (tag === "Game") {
      if (!f.DatabaseID || !wanted.has(f.Platform)) return;
      onPlatform.add(f.DatabaseID);
      if (named(f.Name)) games.set(f.DatabaseID, pick(f, GAME_FIELDS));
    } else if (tag === "GameAlternateName") {
      if (!onPlatform.has(f.DatabaseID) || !f.AlternateName || !named(f.AlternateName)) return;
      alternates.push([f.DatabaseID, f.AlternateName]);
      if (!games.has(f.DatabaseID)) later.add(f.DatabaseID);
    } else if (tag === "GameImage") {
      if ((games.has(f.DatabaseID) || later.has(f.DatabaseID)) && SHOT_TYPES.has(f.Type) && f.FileName) {
        images.set(f.DatabaseID, [...(images.get(f.DatabaseID) ?? []), { FileName: f.FileName, Type: f.Type }]);
      }
    }
  });
  if (later.size) {
    await eachBlock(openXml(), (tag, f) => {
      if (tag === "Game" && later.has(f.DatabaseID)) games.set(f.DatabaseID, pick(f, GAME_FIELDS));
    });
  }
  return { games, alternates, images };
}

/** Mame.xml's sets: Map(short name → { Name, CloneOf, Publisher, … }), only the `wanted` ones (all without). */
export async function readMame(input, wanted = null) {
  const sets = new Map();
  await eachBlock(input, (tag, f) => {
    const short = String(f.FileName ?? "").toLowerCase();
    if (tag === "MameFile" && short && (!wanted || wanted.has(short))) sets.set(short, pick(f, MAME_FIELDS));
  });
  return sets;
}
