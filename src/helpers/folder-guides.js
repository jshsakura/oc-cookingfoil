/**
 * A short README.md in each folder the server owns or reads, so a person or an
 * AI tool opening that folder knows what goes there, how it is laid out, what
 * names the server relies on, what the server does there by itself and what
 * does not belong.
 *
 *   role folders    incoming, games, homebrew, retro, patches, saves, keys, data
 *                   (storage-layout.js ROLES, wherever each one lives)
 *   retro folders   roms/, roms/<folder>/ of every system (systems.js), the BIOS
 *                   folder, thumbnails/ and bezels/
 *
 * The text comes from the tables the server works from (the system table, the
 * BIOS rules, the drop box's constants), so a guide says what the server does.
 * English, like the storage guide: the reader is as often an AI tool as a person.
 *
 * plan() is pure: it lists every guide with its text. writeAll() writes them
 * through guide-file.js, which never makes a folder and leaves a guide someone
 * edited (or a README of their own) as it is. What it last wrote is kept for
 * the admin endpoint (list()), so requests never read the disk.
 */
import path from "path";
import { BIOS } from "../retro/bios.js";
import { biosSets, dependencies, firstNeeding } from "../retro/arcade.js";
import { coreFile } from "../retro/pack-status.js";
import { sdPathOf } from "../retro/base-pack.js";
import { GAME_RE, SETTLE_MS, SUB } from "../meta/library-organize.js";
import { GUIDE_NAME, stamp, writeGuide } from "./guide-file.js";

const SWITCH_EXTS = GAME_RE.source.match(/\(([^)]+)\)/)[1].split("|").map((e) => `.${e}`).join(" ");
const DISC_LISTS = [".cue", ".m3u"];
const ENDPOINT = "`GET /admin/api/storage-guide?format=json` returns the storage guide and every folder guide (`guides`: path and text).";
const NOT_CONTENT = "This README.md is the server's guide, never content: scanners skip it. Edit it and the server stops updating it.";
const BY_HAND = "The server never renames, moves or deletes anything here on its own. Renames and deletes happen only when an admin starts them on the admin page, for that run.";
const RETRO_TRASH = "A game an admin deletes goes to `.trash/` in the retro folder, with its box art and bezel, and can be restored from the retro tab.";

const posix = (p) => p.split(path.sep).join("/");
const bullets = (lines) => lines.map((l) => `- ${l}`);

/** `to` as seen from folder `from`: relative when it is below their common storage, else in full. Pure. */
function shown(from, to) {
  const rel = path.relative(from, to);
  return rel && !path.isAbsolute(rel) ? posix(rel) : to;
}

export const CORE_NOTE = "A core is a Switch .nro built with libnx, named exactly `<core>_libretro_libnx.nro`; the .dll, .so or .dylib cores of PC RetroArch do not work.";

/** Where a pack file (relative to the pack folder) lands on the console's SD card. Pure. */
const onConsole = (rel) => `sdmc:/${sdPathOf(rel)}`;

// A BIOS rule's entry is a file name now; an object ({ file, md5 }) is read the same way.
const fileOf = (e) => (typeof e === "string" ? e : e?.file ?? e?.path ?? e?.name ?? null);
const asGroup = (g) => (Array.isArray(g) ? g : [g]);

/**
 * The BIOS a system needs, from bios.js: { required: [[file]], optional: [[file]] } where a group is
 * met by any one of its files and each file is { file, console, md5 }. Fields the rule does not have
 * (optional, md5) are simply absent. Null when the system needs none. Pure.
 */
export function biosFiles(id, rules = BIOS) {
  const rule = rules[id];
  if (!rule) return null;
  const md5Of = (e, file) => {
    const m = e?.md5 ?? rule.md5?.[file];
    return m ? [m].flat().join(" or ") : null;
  };
  const files = (g) => asGroup(g).map((e) => {
    const file = fileOf(e);
    return file ? { file, console: onConsole(`system/${file}`), md5: md5Of(e, file) } : null;
  }).filter(Boolean);
  const groups = (list) => (Array.isArray(list) ? list : []).map(files).filter((g) => g.length);
  return { required: groups(rule.groups), optional: groups(rule.optional) };
}

/** One BIOS group as text: each file where it goes on the server (under `shownDir`) and on the console, md5 when known. Pure. */
function groupText(g, shownDir) {
  const one = (f) => `\`${shownDir ? `${shownDir}/` : ""}${f.file}\` (console: \`${f.console}\`)${f.md5 ? `, md5 ${f.md5}` : ""}`;
  return g.length > 1 ? `one of ${g.map(one).join(", ")}` : one(g[0]);
}

/** The BIOS lines of a system's guide, required before optional. Pure. */
function biosLines(id, shownDir) {
  const b = biosFiles(id);
  if (!b || (!b.required.length && !b.optional.length)) return ["BIOS: none needed."];
  return [
    ...b.required.map((g) => `BIOS, required: ${groupText(g, shownDir)}.`),
    ...b.optional.map((g) => `BIOS, optional: ${groupText(g, shownDir)}.`),
  ];
}

/** The BIOS a system needs, as one line of text, or null (the storage guide's table). Pure. */
export function biosText(id) {
  const b = biosFiles(id);
  if (!b || !b.required.length) return null;
  return b.required.map((g) => (g.length > 1 ? `one of ${g.map((f) => `\`${f.file}\``).join(", ")}` : `\`${g[0].file}\``)).join(" and ");
}

function render({ title, lead, holds, tree, naming = [], server, not, more }) {
  return [
    `# ${title}`, "", ...lead, "",
    "## What goes here", ...bullets(holds), "",
    "## Example", "```text", ...tree, "```", "",
    ...(naming.length ? ["## Names the server relies on", ...bullets(naming), ""] : []),
    "## What the server does here", ...bullets(server), "",
    "## Do not put here", ...bullets(not), "",
    "## More", ...bullets(more), "",
  ].join("\n");
}

/** The lines every guide ends with: where the storage guide is, and the endpoint. */
const moreLines = (dir, storageGuide, extra = []) => [...extra, `Storage guide (every folder): \`${shown(dir, storageGuide)}\`.`, ENDPOINT];

const ROLES = {
  incoming: ({ systems, dir, base, storageGuide }) => {
    const ids = Object.keys(systems);
    const cart = Object.entries(systems).find(([, s]) => !s.extensions.some((e) => DISC_LISTS.includes(e)));
    const disc = Object.entries(systems).find(([, s]) => s.extensions.includes(".cue"));
    return {
      title: `Drop box (${base})`,
      lead: ["Files put here are sorted into the library by the server, then are gone from here."],
      holds: [
        `Switch games (${SWITCH_EXTS}), anywhere in this folder.`,
        `Retro ROMs in a folder named after their system: ${ids.join(", ")}. Names other front ends use (SNES, psx, genesis) work too.`,
        "A homebrew app that is one .nro file.",
      ],
      tree: [
        `${base}/`,
        "  Some Game [0100000000010000][v0].nsp",
        ...(cart ? [`  ${cart[0]}/`, `    Some Game (USA)${cart[1].extensions[0]}`] : []),
        ...(disc ? [`  ${disc[0]}/`, "    Some Game (USA).cue", "    Some Game (USA) (Track 1).bin"] : []),
        "  SomeApp.nro",
      ],
      naming: [
        "A Switch file prod.keys cannot read needs `[TITLEID]` in its name, and an update or DLC also `[vN]`.",
        "ROMs keep their names: box art and bezels are found by them.",
      ],
      server: [
        `Every minute it moves the files that have not changed for ${SETTLE_MS / 1000} seconds: Switch games to the games folder (\`<game>/\`, \`<game>/${SUB.update}/\`, \`<game>/${SUB.dlc}/\`), ROMs to \`roms/<system folder>/\` in the retro folder, a .nro to \`<name>/\` in the homebrew folder.`,
        "A .cue or .m3u takes the files it lists along. Nothing is ever overwritten.",
        "A file it cannot place stays here, and the admin page's library tab says why.",
        NOT_CONTENT,
      ],
      not: [
        "ScummVM games, homebrew app folders, patches and saves: upload them on the admin page's upload tab.",
        "Files you want to keep here: games and ROMs are moved out once they stop changing.",
      ],
      more: moreLines(dir, storageGuide),
    };
  },
  games: ({ dir, base }) => ({
    title: `Switch games (${base})`,
    lead: ["The shop lists the Switch games in this folder."],
    holds: [`${SWITCH_EXTS} files, one folder per game.`, `Updates in \`<game>/${SUB.update}/\`, DLC in \`<game>/${SUB.dlc}/\`.`],
    tree: [
      `${base}/`, "  Some Game/", "    Some Game [0100000000010000][v0].nsp",
      `    ${SUB.update}/`, "      Some Game [0100000000010800][v65536].nsp",
      `    ${SUB.dlc}/`, "      Some Game Pack [0100000000011001][v0].nsp",
    ],
    naming: [
      "`[TITLEID]` and `[vN]` in a file name tell the shop what the file is when prod.keys cannot read it. The drop box adds them.",
      "Folder names are yours: every folder below this one is read, and a game keeps its folder when more of its files arrive.",
    ],
    server: [
      "Lists every game file here in the shop and checks the files for damage in the hours the admin page sets.",
      `${BY_HAND} NSZ conversion, once an admin turns it on, replaces .nsp files with .nsz.`,
      "Files left in the drop box (incoming) arrive here sorted.",
      NOT_CONTENT,
    ],
    not: [
      "Retro ROMs, homebrew, patches and saves: each has its own folder.",
      "Files still being copied: copy them into the drop box, which waits until they stop changing.",
      "Other files: the shop does not serve them; the admin page lists them as other files.",
    ],
  }),
  homebrew: ({ base }) => ({
    title: `Homebrew (${base})`,
    lead: ["The shop lists the homebrew apps in this folder; each goes to the console's `switch/<folder>/`."],
    holds: [
      "One folder per app, holding its .nro.",
      "An app that needs data files keeps them beside its .nro; the whole folder goes to the console.",
    ],
    tree: [`${base}/`, "  SomeApp/", "    SomeApp.nro", "  SomePort/", "    SomePort.nro", "    data/"],
    naming: ["Folder and .nro names use letters, digits, `-`, `_` and `.` only. The folder name is the app's folder on the SD card."],
    server: [
      "Lists each folder that holds a .nro. The homebrew tab's button registers a folder with more files as a folder install and writes `.cookingfoil.json` in it.",
      "Pictures an admin sets for an app are kept in its `metadata/` folder. Apps followed on GitHub are kept in the data folder, not here.",
      BY_HAND,
      NOT_CONTENT,
    ],
    not: ["Zip files: upload them on the admin page's upload tab, which unpacks them here.", "Loose files at the top of this folder: an app needs a folder of its own.", "Switch games: the games folder."],
  }),
  retro: ({ base, packDir, dir }) => ({
    title: `Retro (${base})`,
    lead: ["Retro ROMs, their art and the RetroArch pack. Each folder below has its own README.md."],
    holds: [
      "`roms/<system folder>/`: ROMs, one folder per system.",
      "`thumbnails/<system folder>/Named_Boxarts/`: box art. `bezels/<system folder>/`: bezels.",
      `\`${shown(dir, packDir)}/\`: the RetroArch pack (retroarch.nro, cores/, system/ for BIOS files).`,
      `\`${shown(dir, packDir)}/cores/\`: one core per system (console: \`${onConsole("cores/x").replace(/x$/, "")}\`). ${CORE_NOTE}`,
      "`systems.json`: changes a system (folder, core, extensions) or adds one. `art-map/`, `ratings.json`, `arcade-names.json`: original titles and ratings.",
    ],
    tree: [`${base}/`, "  roms/snes/Some Game (USA).sfc", "  thumbnails/snes/Named_Boxarts/Some Game (USA).png", "  bezels/snes/Some Game (USA).png", `  ${shown(dir, packDir)}/system/`],
    server: [
      "Reads this folder at every retro scan. With retroScaffold on it makes a ROM folder for each system the Switch can run, and the BIOS folder.",
      "Downloads box art and bezels when an admin starts it on the retro tab.",
      `${BY_HAND} ${RETRO_TRASH}`,
      NOT_CONTENT,
    ],
    not: ["Switch games and homebrew: their own folders."],
  }),
  patches: ({ base }) => ({
    title: `Patches (${base})`,
    lead: ["Mods and cheats the shop hands out; a console installs them onto its SD card and turns them on and off."],
    holds: [
      "`<TITLEID>/<patch name>/`: one folder per patch, its files laid out as from the SD card root.",
      "`homebrew/<app>/<patch name>/`: a homebrew app's patch, its files as in the app's `switch/<app>/`.",
      "`patch.json` in a patch folder: read once, the first time the folder is seen, for its name and description. It never ships.",
    ],
    tree: [`${base}/`, "  0100000000010000/", "    60 FPS/", "      atmosphere/contents/0100000000010000/exefs/main.npdm", "  homebrew/", "    SomePort/", "      HD textures/"],
    naming: [
      "TITLEID is the base game's id: 16 hexadecimal digits.",
      "Every file must sit under a path the patch's own game owns. One stray file, a link or a path the console cannot hold leaves the whole patch out (the log says why).",
    ],
    server: ["Reads this folder every minute and lists each patch; it never changes a file here.", BY_HAND, NOT_CONTENT],
    not: ["Loose files at the top or in a title folder: a patch needs a folder of its own.", "Saves: the saves folder."],
  }),
  saves: ({ base }) => ({
    title: `Saves (${base})`,
    lead: ["Save files the shop hands out, for a console to restore into a player's save."],
    holds: [
      "`<TITLEID>/<save name>/`: the save folder's contents.",
      "`homebrew/<app>/<save name>/`: a homebrew app's save, its files as in the app's `switch/<app>/`.",
      "`meta.json` beside them: { name, description, gameVersion, saveType (device or account), source, ko }. It never ships.",
    ],
    tree: [`${base}/`, "  0100000000010000/", "    All unlocked/", "      meta.json", "      save.dat"],
    naming: ["TITLEID is the base game's id: 16 hexadecimal digits."],
    server: ["Reads this folder and lists each save; it never changes a file here.", BY_HAND, NOT_CONTENT],
    not: ["Loose files at the top or in a title folder: a save needs a folder of its own.", "Patches: the patches folder."],
  }),
  keys: ({ base }) => ({
    title: `Keys (${base})`,
    lead: ["The console keys the server reads what each game file is with."],
    holds: ["`prod.keys`, dumped from your own console."],
    tree: [`${base}/`, "  prod.keys"],
    naming: ["The file name must be `prod.keys`."],
    server: [
      "Reads prod.keys for game names and icons, NSZ conversion and home-screen shortcuts. It never writes here, and never logs a key.",
      "Keys uploaded on the admin page go to the data folder instead, and are read first.",
      NOT_CONTENT,
    ],
    not: ["Other files: nothing else here is read."],
  }),
  data: ({ base }) => ({
    title: `Server data (${base})`,
    lead: ["The server's own files. Back this folder up."],
    holds: ["Accounts, devices, settings, the index database and caches, all written by the server.", "`backups/<YYYY-MM-DD>/`: the daily backup, a copy on this same disk."],
    tree: [`${base}/`, "  backups/", "    2026-01-01/", "  homebrew/", "  keys/"],
    server: ["Writes here all the time, and keeps the daily backups for the days the admin page sets.", NOT_CONTENT],
    not: ["Games, ROMs or files of your own.", "Edits while the server runs: stop it first."],
  }),
};

/** The guides of the role folders. `storageGuide` is the storage guide's path; a folder holding it gets no second one. Pure. */
function roleGuides({ layout, systems, storageGuide, packDir, retro }) {
  const out = [];
  for (const [role, make] of Object.entries(ROLES)) {
    const dir = layout?.dirs?.[role];
    if (!dir || (role === "retro" && !retro)) continue;
    const file = path.join(dir, GUIDE_NAME);
    if (file === storageGuide) continue;
    const g = make({ systems, storageGuide, dir, base: path.basename(dir), packDir });
    out.push({ path: file, body: render({ ...g, more: g.more ?? moreLines(dir, storageGuide) }) });
  }
  return out;
}

/** The guide of one system's folder. Pure. */
function systemGuide({ id, s, runs, dir, retroDir, biosDir, packDir, storageGuide }) {
  const ext = s.extensions;
  const arcade = (s.tableCore ?? s.core) === "fbneo";
  const scummvm = ext.includes(".scummvm");
  const discs = !arcade && !scummvm && ext.some((e) => [...DISC_LISTS, ".chd"].includes(e));
  const f = s.folder;
  const cores = [...new Set([s.core, s.tableCore].filter(Boolean))];
  const bioses = arcade ? biosSets() : [];
  // The most common BIOS set makes the clearest example when the DAT has it.
  const sample = arcade ? firstNeeding(bioses.includes("neogeo") ? "neogeo" : bioses[0] ?? "") : null;
  const needs = sample ? dependencies(sample) : [];
  const first = ext.find((e) => e !== ".zip" && e !== ".7z") ?? ext[0] ?? "";
  const tree = arcade
    ? [`${f}/`, ...[sample, ...needs].filter(Boolean).map((set) => `  ${set}.zip`)]
    : scummvm
      ? [`${f}/`, "  monkey/", "    monkey.scummvm", "    title.json", "    MONKEY.000"]
      : discs
        ? [`${f}/`, `  Some Game (USA)${first}`, "  Big Game (USA)/", ...(ext.includes(".m3u") ? ["    Big Game (USA).m3u"] : []), `    Big Game (USA) (Disc 1)${first}`, `    Big Game (USA) (Disc 2)${first}`]
        : [`${f}/`, `  Some Game (USA)${first}`, `  Other Game (Japan)${first}`];
  return render({
    title: `${s.names?.en ?? id} ROMs (${id})`,
    lead: [
      `The retro catalog lists the games in this folder as ${s.names?.en ?? id}${s.coreName ? `, played with ${s.coreName}` : ""}.`,
      ...(runs ? [] : ["", "The Switch build of RetroArch the server pins has no such core: put the core file below in the pack before these games run."]),
    ],
    holds: [
      `ROM files: ${ext.join(" ")}, here or one folder deep.`,
      ...cores.map((c) => `Core: \`${path.posix.basename(coreFile(c))}\` in \`${shown(dir, packDir)}/cores/\` (console: \`${onConsole(coreFile(c))}\`). ${CORE_NOTE}`),
      // An arcade BIOS is a set zip kept with the games (below), not a file of the system folder.
      ...(arcade && !biosFiles(id) ? [] : biosLines(id, shown(dir, biosDir))),
      ...(discs ? ["Discs of one game keep \"(Disc 1)\", \"(Disc 2)\" in their names. A .cue or .m3u brings the files it lists, which are then not games of their own."] : []),
      ...(arcade ? [
        `FBNeo sets keep their short names. A set loads its parent and BIOS zips${sample && needs.length ? ` (${sample}.zip loads ${needs.map((n) => `${n}.zip`).join(", ")})` : ""}: keep them here beside it; they are not listed as games.`,
        `BIOS sets of the FBNeo DAT: ${bioses.map((b) => `${b}.zip`).join(" ")}.`,
        "`arcade-names.json` in the retro folder names a set in other languages.",
      ] : []),
      ...(scummvm ? ["One folder per game, with the game's files and a `<id>.scummvm` file; the whole folder goes to the console. `title.json` ({ \"en\": \"…\", \"ko\": \"…\" }) names it."] : []),
    ],
    tree,
    naming: [
      `Box art: \`thumbnails/${f}/Named_Boxarts/<ROM name>.png\`; bezel: \`bezels/${f}/<ROM name>.png\` (\`_default.png\` for every game), both in the retro folder.`,
      `<ROM name> is the ROM's file name without its extension${arcade ? " (the set name)" : ""}. Rename a ROM and rename its art with it.`,
      "A game is known by its path inside this folder: a ROM moved to another subfolder is a new game to the server.",
    ],
    server: [`Lists the games at every retro scan. ROMs dropped in \`incoming/${id}/\` arrive here.`, `${BY_HAND} ${RETRO_TRASH}`, NOT_CONTENT],
    not: ["Files of other extensions: they are not listed.", "Box art and bezels: `thumbnails/` and `bezels/` in the retro folder."],
    more: moreLines(dir, storageGuide, [`All system folders: \`${shown(dir, path.join(retroDir, "roms", GUIDE_NAME))}\`.`]),
  });
}

/** The guides of the retro folder's own folders. Pure. */
function retroGuides({ systems, runnable, retroDir, biosDir, packDir, storageGuide }) {
  const roms = path.join(retroDir, "roms");
  const thumbs = path.join(retroDir, "thumbnails");
  const bezels = path.join(retroDir, "bezels");
  const runs = new Set(runnable);
  const biosIds = Object.keys(BIOS).filter((id) => systems[id]);
  const out = [{
    path: path.join(roms, GUIDE_NAME),
    body: render({
      title: "Retro ROM folders (roms)",
      lead: ["One folder per system. Each has its own README.md with its extensions, core and BIOS."],
      holds: [
        `System folders: ${Object.values(systems).map((s) => `\`${s.folder}\``).join(", ")}.`,
        "A folder named the way other front ends name a system (SNES, psx, genesis) is read in place of the system's own, when that one is missing or empty.",
        `Each system's core goes in \`${shown(roms, packDir)}/cores/\`. ${CORE_NOTE}`,
      ],
      tree: ["roms/", ...Object.values(systems).slice(0, 2).map((s) => `  ${s.folder}/Some Game (USA)${s.extensions[0] ?? ""}`)],
      server: [
        "With retroScaffold on, makes a folder for each system the Switch can run; a deleted one comes back at the next scan. The retro tab lists folders no system reads.",
        `${BY_HAND} ${RETRO_TRASH}`,
        NOT_CONTENT,
      ],
      not: ["ROMs directly here: they belong in a system folder. Drop them in `incoming/<system>/` to have them sorted."],
      more: moreLines(roms, storageGuide),
    }),
  }];
  const seen = new Set(out.map((g) => g.path));
  for (const [id, s] of Object.entries(systems)) {
    const dir = path.join(roms, s.folder);
    const file = path.join(dir, GUIDE_NAME);
    if (seen.has(file)) continue;
    seen.add(file);
    out.push({ path: file, body: systemGuide({ id, s, runs: runs.has(id), dir, retroDir, biosDir, packDir, storageGuide }) });
  }
  out.push({
    path: path.join(biosDir, GUIDE_NAME),
    body: render({
      title: `RetroArch BIOS (${path.basename(biosDir)})`,
      lead: ["RetroArch on the console reads BIOS and firmware files from here; the server sends this folder to each console with the RetroArch pack."],
      holds: biosIds.flatMap((id) => biosLines(id, "").map((l) => `${systems[id].names?.en ?? id} (\`${id}\`): ${l.replace(/^BIOS, /, "")}`)),
      tree: [`${path.basename(biosDir)}/`, ...biosIds.map((id) => biosFiles(id).required[0]?.[0]?.file).filter(Boolean).map((file) => `  ${file}`)],
      naming: ["File names must match exactly, with the folder in front when one is shown. A required group is met by any one of its files."],
      server: [
        "Ships no BIOS of its own: the files are copyrighted. The retro tab lists the ones missing for systems that have games.",
        "Sends every file here to the consoles as it is, and never renames or deletes one. This README.md stays on the server.",
      ],
      not: [`Cores: \`${shown(biosDir, path.join(packDir, "cores"))}/\`.`, "ROMs: `roms/` in the retro folder."],
      more: moreLines(biosDir, storageGuide),
    }),
  });
  out.push({
    path: path.join(thumbs, GUIDE_NAME),
    body: render({
      title: "Retro box art (thumbnails)",
      lead: ["The retro catalog shows box art from here, in the libretro-thumbnails layout."],
      holds: ["`<system folder>/Named_Boxarts/<ROM name>.png` (or .jpg). <system folder> is the system's folder under roms/."],
      tree: ["thumbnails/", ...Object.values(systems).slice(0, 2).map((s) => `  ${s.folder}/Named_Boxarts/Some Game (USA).png`)],
      naming: ["<ROM name> is the ROM's file name without its extension; the characters & * / : ` < > ? \\ | \" in it may be written as _."],
      server: [
        "Downloads missing box art when an admin starts it on the retro tab, and at start shrinks large covers here in place.",
        "Box art of a game an admin deletes goes to `.trash/` with it.",
        NOT_CONTENT,
      ],
      not: ["Bezels: `bezels/`.", "ROMs."],
      more: moreLines(thumbs, storageGuide),
    }),
  });
  out.push({
    path: path.join(bezels, GUIDE_NAME),
    body: render({
      title: "Retro bezels (bezels)",
      lead: ["The picture around the game screen on the console, per game or per system."],
      holds: ["`<system folder>/<ROM name>.png`, with its `.cfg` and `_override.cfg` beside it.", "`<system folder>/_default.png`: every game of the system without a bezel of its own."],
      tree: ["bezels/", ...Object.values(systems).slice(0, 1).flatMap((s) => [`  ${s.folder}/_default.png`, `  ${s.folder}/Some Game (USA).png`])],
      naming: ["<ROM name> is the ROM's file name without its extension."],
      server: ["Downloads bezels from The Bezel Project when an admin starts it on the retro tab.", "A bezel of a game an admin deletes goes to `.trash/` with it.", NOT_CONTENT],
      not: ["Box art: `thumbnails/`.", "ROMs."],
      more: moreLines(bezels, storageGuide),
    }),
  });
  return out;
}

/**
 * Every folder guide, as [{ path, body }]: the role folders' and, when `retro` (the retro folder is
 * there and in use), the retro folder's. `storageGuide` is where the storage guide lives. Pure.
 */
export function plan({ layout, systems, runnable = [], retroDir, biosDir, packDir, storageGuide, retro = true }) {
  const roles = roleGuides({ layout, systems, storageGuide, packDir, retro });
  return retro ? [...roles, ...retroGuides({ systems, runnable, retroDir, biosDir, packDir, storageGuide })] : roles;
}

let known = new Map();
let queue = Promise.resolve();

/**
 * Writes each guide whose folder is there (missing or stale only); returns [{ path, state, error? }].
 * The ones with a folder are kept with their text for list(), replacing what an earlier call kept for the same paths.
 * Calls run one after another: the start's write and the first scan's never write the same file at once.
 */
export function writeAll(guides) {
  const run = queue.then(async () => {
    const results = [];
    for (const g of guides) {
      const r = await writeGuide(g.path, g.body);
      results.push(r);
      if (r.state === "no-folder") known.delete(g.path);
      else known.set(g.path, { path: g.path, state: r.state, text: stamp(g.body) });
    }
    return results;
  });
  queue = run.catch(() => {});
  return run;
}

/** The guides kept from the last writes, by path: no disk. */
export const list = () => [...known.values()].sort((a, b) => a.path.localeCompare(b.path));

/** Forgets what was written (the setting turned off). */
export function forget() {
  known = new Map();
}
