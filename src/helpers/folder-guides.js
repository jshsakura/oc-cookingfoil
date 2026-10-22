/**
 * What goes in each folder the server owns or reads, as data: for the admin API
 * (routes/admin/storage-guide-api.js) and the read capabilities in
 * capabilities/library.js, which both call helpers/storage-guide.js. The
 * server writes none of this to disk: no README goes into any folder, and a
 * README.md someone keeps there is theirs (helpers/readme-name.js).
 *
 *   role folders    incoming, games, homebrew, retro, patches, saves, keys, data
 *                   (storage-layout.js ROLES, wherever each one lives)
 *   retro folders   roms/, roms/<folder>/ of every system (systems.js), the BIOS
 *                   folder, thumbnails/ and bezels/
 *
 * Each guide is { path, dir, consolePath, role, system?, title, purpose, accepts,
 * structure, naming, server, doNotPut, core, bios, arcade, text }. `path` is the
 * folder relative to the storage root, as "<role>/<below>": the same on a server
 * with separate mounts, where `dir` says where the folder really is. `text` is the
 * same guide rendered as Markdown, for agents. English: the reader is as often an
 * AI tool as a person.
 *
 * Everything comes from the tables the server works from (the system table, the
 * BIOS rules, the FBNeo DAT, the drop box's constants), so a guide says what the
 * server does. Every function here is pure.
 */
import path from "path";
import { BIOS, ruleGroups } from "../retro/bios.js";
import { biosSets, dependencies, firstNeeding } from "../retro/arcade.js";
import { coreFile } from "../retro/pack-status.js";
import { sdPathOf } from "../retro/base-pack.js";
import { GAME_RE, SETTLE_MS, SUB } from "../meta/library-organize.js";

const SWITCH_EXTS = GAME_RE.source.match(/\(([^)]+)\)/)[1].split("|").map((e) => `.${e}`);
const DISC_LISTS = [".cue", ".m3u"];
const ENDPOINT = "`GET /admin/api/storage-guide/folder?path=<path>` returns one folder's guide; `GET /admin/api/storage-guide?format=json` returns every folder's.";
const README_NOTE = "A README.md of your own here is left alone and never taken for content.";
const BY_HAND = "The server never renames, moves or deletes anything here on its own. Renames and deletes happen only when an admin starts them on the admin page, for that run.";

/** Where deletes go. One place, so every guide says the same until the shared trash comes. */
export const TRASH_NOTE = "Deletes go to a trash only in the retro folder for now: a game an admin deletes goes to `.trash/` there with its box art and bezel, and the retro tab restores it. Elsewhere a delete is final until the shared trash comes.";

export const CORE_NOTE = "A core is a Switch .nro built with libnx, named exactly `<core>_libretro_libnx.nro`; the .dll, .so or .dylib cores of PC RetroArch do not work.";

const posix = (p) => p.split(path.sep).join("/");
const bullets = (lines) => lines.map((l) => `- ${l}`);
const inside = (dir, abs) => {
  const rel = path.relative(dir, abs);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) ? rel : null;
};

/**
 * `abs` as "<role>/<below>" through the role folder holding it (the deepest, so a drop box inside the
 * games folder is incoming), or in full when no role folder holds it.
 */
export function rolePath(layout, abs) {
  let best = null;
  for (const [role, dir] of Object.entries(layout?.dirs ?? {})) {
    const rel = inside(dir, abs);
    if (rel !== null && (!best || dir.length > best.dir.length)) best = { role, dir, rel };
  }
  if (!best) return posix(abs);
  return best.rel ? `${best.role}/${posix(best.rel)}` : best.role;
}

/** Where a pack file (relative to the pack folder) lands on the console's SD card. */
const onConsole = (rel) => `sdmc:/${sdPathOf(rel)}`;

// A BIOS rule's entry is a file name now; an object ({ file, md5 }) is read the same way.
const fileOf = (e) => (typeof e === "string" ? e : e?.file ?? e?.path ?? e?.name ?? null);
const asGroup = (g) => (Array.isArray(g) ? g : [g]);

/**
 * The BIOS a system takes, from bios.js (ruleGroups): { required: [[file]], optional: [[file]],
 * forExt: [{ ext, files: [file] }] } where a group is met by any one of its files and each file is
 * { file, console, md5 }. `forExt` is needed only by games with those extensions (nes .fds, saturn
 * .m3u). Null when bios.js has no rule for the system.
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
  const groups = (list) => list.map(files).filter((g) => g.length);
  const all = ruleGroups(rule);
  return {
    required: groups(all.filter((g) => g.required && !g.ext).map((g) => g.files)),
    optional: groups(all.filter((g) => !g.required).map((g) => g.files)),
    forExt: all.filter((g) => g.required && g.ext).map((g) => ({ ext: g.ext, files: files(g.files) })).filter((g) => g.files.length),
  };
}

/** One BIOS group as text: each file where it goes on the server (under `dir`) and on the console, md5 when known. */
function groupText(g, dir) {
  const one = (f) => `\`${dir ? `${dir}/` : ""}${f.file}\` (console: \`${f.console}\`)${f.md5 ? `, md5 ${f.md5}` : ""}`;
  return g.length > 1 ? `one of ${g.map(one).join(", ")}` : one(g[0]);
}

/** The BIOS lines of a system's guide, required before optional. */
function biosLines(b, dir) {
  if (!b || (!b.required.length && !b.optional.length && !b.forExt.length)) return ["BIOS: none needed."];
  return [
    ...b.required.map((g) => `BIOS, required: ${groupText(g, dir)}.`),
    ...b.forExt.map((g) => `BIOS, required for ${g.ext.join(" ")} games: ${groupText(g.files, dir)}.`),
    ...b.optional.map((g) => `BIOS, optional: ${groupText(g, dir)}.`),
  ];
}

/** The BIOS a system needs, as one line of text, or null (the storage guide's table). */
export function biosText(id) {
  const b = biosFiles(id);
  if (!b || !b.required.length) return null;
  return b.required.map((g) => (g.length > 1 ? `one of ${g.map((f) => `\`${f.file}\``).join(", ")}` : `\`${g[0].file}\``)).join(" and ");
}

/** A guide as Markdown. */
function render(g) {
  return [
    `# ${g.title}`, "", ...g.purpose, "",
    "## What goes here", ...bullets(g.holds), "",
    "## Example", "```text", ...g.structure, "```", "",
    ...(g.naming.length ? ["## Names the server relies on", ...bullets(g.naming), ""] : []),
    "## What the server does here", ...bullets(g.server), "",
    "## Do not put here", ...bullets(g.doNotPut), "",
    "## More", ...bullets([...(g.more ?? []), ENDPOINT]), "",
  ].join("\n");
}

/** A guide's data and its Markdown, in the shape every guide has. */
function guide(at, dir, g) {
  return {
    path: at, dir, consolePath: g.consolePath ?? null, role: g.role, ...(g.system ? { system: g.system } : {}),
    title: g.title, purpose: g.purpose, accepts: g.accepts ?? [], structure: g.structure, naming: g.naming ?? [],
    server: g.server, doNotPut: g.doNotPut, core: g.core ?? null, bios: g.bios ?? null, arcade: g.arcade ?? null,
    text: render({ naming: [], ...g }),
  };
}

const ROLES = {
  incoming: ({ systems, at }) => {
    const cart = Object.entries(systems).find(([, s]) => !s.extensions.some((e) => DISC_LISTS.includes(e)));
    const disc = Object.entries(systems).find(([, s]) => s.extensions.includes(".cue"));
    return {
      title: `Drop box (${at})`,
      purpose: ["Files put here are sorted into the library by the server, then are gone from here."],
      accepts: [...new Set([...SWITCH_EXTS, ...Object.values(systems).flatMap((s) => s.extensions), ".nro"])],
      holds: [
        `Switch games (${SWITCH_EXTS.join(" ")}), anywhere in this folder.`,
        `Retro ROMs in a folder named after their system: ${Object.keys(systems).join(", ")}. Names other front ends use (SNES, psx, genesis) work too.`,
        "A homebrew app that is one .nro file.",
      ],
      structure: [
        "incoming/",
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
        `Every minute it moves the files that have not changed for ${SETTLE_MS / 1000} seconds: Switch games to the games folder (\`games/<game>/\`, \`<game>/${SUB.update}/\`, \`<game>/${SUB.dlc}/\`), ROMs to \`retro/roms/<system folder>/\`, a .nro to \`homebrew/<name>/\`.`,
        "A .cue or .m3u takes the files it lists along. Nothing is ever overwritten.",
        "A file it cannot place stays here, and the admin page's library tab says why.",
        README_NOTE,
      ],
      doNotPut: [
        "ScummVM games, homebrew app folders, patches and saves: upload them on the admin page's upload tab.",
        "Files you want to keep here: games and ROMs are moved out once they stop changing.",
      ],
    };
  },
  games: ({ at }) => ({
    title: `Switch games (${at})`,
    purpose: ["The shop lists the Switch games in this folder."],
    accepts: SWITCH_EXTS,
    holds: [`${SWITCH_EXTS.join(" ")} files, one folder per game.`, `Updates in \`<game>/${SUB.update}/\`, DLC in \`<game>/${SUB.dlc}/\`.`],
    structure: [
      "games/", "  Some Game/", "    Some Game [0100000000010000][v0].nsp",
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
      TRASH_NOTE,
      "Files left in the drop box (incoming) arrive here sorted.",
      README_NOTE,
    ],
    doNotPut: [
      "Retro ROMs, homebrew, patches and saves: each has its own folder.",
      "Files still being copied: copy them into the drop box, which waits until they stop changing.",
      "Other files: the shop does not serve them; the admin page lists them as other files.",
    ],
  }),
  homebrew: ({ at }) => ({
    title: `Homebrew (${at})`,
    purpose: ["The shop lists the homebrew apps in this folder; each goes to the console's `switch/<folder>/`."],
    consolePath: "sdmc:/switch/",
    accepts: [".nro"],
    holds: [
      "One folder per app, holding its .nro.",
      "An app that needs data files keeps them beside its .nro; the whole folder goes to the console.",
    ],
    structure: ["homebrew/", "  SomeApp/", "    SomeApp.nro", "  SomePort/", "    SomePort.nro", "    data/"],
    naming: ["Folder and .nro names use letters, digits, `-`, `_` and `.` only. The folder name is the app's folder on the SD card."],
    server: [
      "Lists each folder that holds a .nro. The homebrew tab's button registers a folder with more files as a folder install and writes `.cookingfoil.json` in it.",
      "Pictures an admin sets for an app are kept in its `metadata/` folder. Apps followed on GitHub are kept in the data folder, not here.",
      BY_HAND,
      TRASH_NOTE,
      README_NOTE,
    ],
    doNotPut: ["Zip files: upload them on the admin page's upload tab, which unpacks them here.", "Loose files at the top of this folder: an app needs a folder of its own.", "Switch games: the games folder."],
  }),
  retro: ({ pack, at }) => ({
    title: `Retro (${at})`,
    purpose: ["Retro ROMs, their art and the RetroArch pack. Each folder below has a guide of its own."],
    holds: [
      "`roms/<system folder>/`: ROMs, one folder per system.",
      "`thumbnails/<system folder>/Named_Boxarts/`: box art. `bezels/<system folder>/`: bezels.",
      `\`${pack}/\`: the RetroArch pack (retroarch.nro, cores/, system/ for BIOS files).`,
      `\`${pack}/cores/\`: one core per system (console: \`sdmc:/retroarch/cores/\`). ${CORE_NOTE}`,
      "`systems.json`: changes a system (folder, core, extensions) or adds one. `art-map/`, `ratings.json`, `arcade-names.json`: original titles and ratings.",
    ],
    structure: ["retro/", "  roms/snes/Some Game (USA).sfc", "  thumbnails/snes/Named_Boxarts/Some Game (USA).png", "  bezels/snes/Some Game (USA).png", `  ${pack.replace(/^retro\//, "")}/system/`],
    server: [
      "Reads this folder at every retro scan. With retroScaffold on it makes a ROM folder for each system the Switch can run, and the BIOS folder.",
      "Downloads box art and bezels when an admin starts it on the retro tab.",
      BY_HAND,
      TRASH_NOTE,
      README_NOTE,
    ],
    doNotPut: ["Switch games and homebrew: their own folders."],
  }),
  patches: ({ at }) => ({
    title: `Patches (${at})`,
    purpose: ["Mods and cheats the shop hands out; a console installs them onto its SD card and turns them on and off."],
    consolePath: "sdmc:/",
    holds: [
      "`<TITLEID>/<patch name>/`: one folder per patch, its files laid out as from the SD card root.",
      "`homebrew/<app>/<patch name>/`: a homebrew app's patch, its files as in the app's `switch/<app>/`.",
      "`patch.json` in a patch folder: read once, the first time the folder is seen, for its name and description. It never ships.",
    ],
    structure: ["patches/", "  0100000000010000/", "    60 FPS/", "      atmosphere/contents/0100000000010000/exefs/main.npdm", "  homebrew/", "    SomePort/", "      HD textures/"],
    naming: [
      "TITLEID is the base game's id: 16 hexadecimal digits.",
      "Every file must sit under a path the patch's own game owns. One stray file, a link or a path the console cannot hold leaves the whole patch out (the log says why).",
    ],
    server: ["Reads this folder every minute and lists each patch; it never changes a file here.", BY_HAND, TRASH_NOTE, README_NOTE],
    doNotPut: ["Loose files at the top or in a title folder: a patch needs a folder of its own.", "Saves: the saves folder."],
  }),
  saves: ({ at }) => ({
    title: `Saves (${at})`,
    purpose: ["Save files the shop hands out, for a console to restore into a player's save."],
    holds: [
      "`<TITLEID>/<save name>/`: the save folder's contents.",
      "`homebrew/<app>/<save name>/`: a homebrew app's save, its files as in the app's `switch/<app>/`.",
      "`meta.json` beside them: { name, description, gameVersion, saveType (device or account), source, ko }. It never ships.",
    ],
    structure: ["saves/", "  0100000000010000/", "    All unlocked/", "      meta.json", "      save.dat"],
    naming: ["TITLEID is the base game's id: 16 hexadecimal digits."],
    server: ["Reads this folder and lists each save; it never changes a file here.", BY_HAND, TRASH_NOTE, README_NOTE],
    doNotPut: ["Loose files at the top or in a title folder: a save needs a folder of its own.", "Patches: the patches folder."],
  }),
  keys: ({ at }) => ({
    title: `Keys (${at})`,
    purpose: ["The console keys the server reads what each game file is with."],
    accepts: ["prod.keys"],
    holds: ["`prod.keys`, dumped from your own console."],
    structure: ["keys/", "  prod.keys"],
    naming: ["The file name must be `prod.keys`."],
    server: [
      "Reads prod.keys for game names and icons, NSZ conversion and home-screen shortcuts. It never writes here, and never logs a key.",
      "Keys uploaded on the admin page go to the data folder instead, and are read first.",
    ],
    doNotPut: ["Other files: nothing else here is read."],
  }),
  data: ({ at }) => ({
    title: `Server data (${at})`,
    purpose: ["The server's own files. Back this folder up."],
    holds: ["Accounts, devices, settings, the index database and caches, all written by the server.", "`backups/<YYYY-MM-DD>/`: the daily backup, a copy on this same disk."],
    structure: ["data/", "  backups/", "    2026-01-01/", "  homebrew/", "  keys/"],
    server: ["Writes here all the time, and keeps the daily backups for the days the admin page sets."],
    doNotPut: ["Games, ROMs or files of your own.", "Edits while the server runs: stop it first."],
  }),
};

/** The arcade facts of the FBNeo system: its BIOS sets and a set that loads one, as an example. */
function arcadeFacts() {
  const bioses = biosSets();
  // The most common BIOS set makes the clearest example when the DAT has it.
  const set = firstNeeding(bioses.includes("neogeo") ? "neogeo" : bioses[0] ?? "");
  const loads = set ? dependencies(set) : [];
  return {
    biosSets: bioses.map((b) => `${b}.zip`),
    example: set ? { set: `${set}.zip`, loads: loads.map((n) => `${n}.zip`) } : null,
    note: "FBNeo sets keep their short names. A set loads its parent and BIOS zips: keep them beside it in this folder; they are not listed as games. `arcade-names.json` in the retro folder names a set in other languages.",
  };
}

/** The guide of one system's folder. */
function systemGuide({ id, s, runs, at, dir, pack, bioses }) {
  const ext = s.extensions;
  const isArcade = (s.tableCore ?? s.core) === "fbneo";
  const scummvm = ext.includes(".scummvm");
  const discs = !isArcade && !scummvm && ext.some((e) => [...DISC_LISTS, ".chd"].includes(e));
  const f = s.folder;
  const name = s.names?.en ?? id;
  const coreOf = (c) => ({ file: path.posix.basename(coreFile(c)), folder: `${pack}/cores`, consolePath: onConsole(coreFile(c)), note: CORE_NOTE });
  const cores = [...new Set([s.core, s.tableCore].filter(Boolean))].map(coreOf);
  const arcade = isArcade ? arcadeFacts() : null;
  const bios = biosFiles(id);
  const first = ext.find((e) => e !== ".zip" && e !== ".7z") ?? ext[0] ?? "";
  const structure = arcade
    ? [`${f}/`, ...(arcade.example ? [arcade.example.set, ...arcade.example.loads] : []).map((z) => `  ${z}`)]
    : scummvm
      ? [`${f}/`, "  monkey/", "    monkey.scummvm", "    title.json", "    MONKEY.000"]
      : discs
        ? [`${f}/`, `  Some Game (USA)${first}`, "  Big Game (USA)/", ...(ext.includes(".m3u") ? ["    Big Game (USA).m3u"] : []), `    Big Game (USA) (Disc 1)${first}`, `    Big Game (USA) (Disc 2)${first}`]
        : [`${f}/`, `  Some Game (USA)${first}`, `  Other Game (Japan)${first}`];
  return guide(at, dir, {
    role: "system",
    system: id,
    title: `${name} ROMs (${id})`,
    purpose: [
      `The retro catalog lists the games in this folder as ${name}${s.coreName ? `, played with ${s.coreName}` : ""}.`,
      ...(runs ? [] : ["", "The Switch build of RetroArch the server pins has no such core: put the core file below in the pack before these games run."]),
    ],
    accepts: ext,
    core: cores[0] ?? null,
    bios,
    arcade,
    holds: [
      `ROM files: ${ext.join(" ")}, here or one folder deep.`,
      ...cores.map((c) => `Core: \`${c.file}\` in \`${c.folder}/\` (console: \`${c.consolePath}\`). ${CORE_NOTE}`),
      // An arcade BIOS is a set zip kept with the games (below), not a file of the BIOS folder.
      ...(arcade && !bios ? [] : biosLines(bios, bioses)),
      ...(discs ? ["Discs of one game keep \"(Disc 1)\", \"(Disc 2)\" in their names. A .cue or .m3u brings the files it lists, which are then not games of their own."] : []),
      ...(arcade ? [
        `${arcade.note}${arcade.example?.loads.length ? ` For example ${arcade.example.set} loads ${arcade.example.loads.join(", ")}.` : ""}`,
        `BIOS sets of the FBNeo DAT: ${arcade.biosSets.join(" ")}.`,
      ] : []),
      ...(scummvm ? ["One folder per game, with the game's files and a `<id>.scummvm` file; the whole folder goes to the console. `title.json` ({ \"en\": \"…\", \"ko\": \"…\" }) names it."] : []),
    ],
    structure,
    naming: [
      `Box art: \`retro/thumbnails/${f}/Named_Boxarts/<ROM name>.png\`; bezel: \`retro/bezels/${f}/<ROM name>.png\` (\`_default.png\` for every game).`,
      `<ROM name> is the ROM's file name without its extension${arcade ? " (the set name)" : ""}. Rename a ROM and rename its art with it.`,
      "A game is known by its path inside this folder: a ROM moved to another subfolder is a new game to the server.",
    ],
    server: [`Lists the games at every retro scan. ROMs dropped in \`incoming/${id}/\` arrive here.`, BY_HAND, TRASH_NOTE, README_NOTE],
    doNotPut: ["Files of other extensions: they are not listed.", "Box art and bezels: `retro/thumbnails/` and `retro/bezels/`."],
    more: ["All system folders: `retro/roms`."],
  });
}

/** The guides of the retro folder's own folders. */
function retroGuides({ layout, systems, runnable, retroDir, packDir }) {
  const at = (abs) => rolePath(layout, abs);
  const roms = path.join(retroDir, "roms");
  const biosDir = path.join(packDir, "system");
  const pack = at(packDir);
  const bioses = at(biosDir);
  const runs = new Set(runnable);
  const biosIds = Object.keys(BIOS).filter((id) => systems[id]);
  const out = [guide(at(roms), roms, {
    role: "roms",
    title: "Retro ROM folders (roms)",
    purpose: ["One folder per system. Each has a guide of its own with its extensions, core and BIOS."],
    holds: [
      `System folders: ${Object.values(systems).map((s) => `\`${s.folder}\``).join(", ")}.`,
      "A folder named the way other front ends name a system (SNES, psx, genesis) is read in place of the system's own, when that one is missing or empty.",
      `Each system's core goes in \`${pack}/cores/\`. ${CORE_NOTE}`,
    ],
    structure: ["roms/", ...Object.values(systems).slice(0, 2).map((s) => `  ${s.folder}/Some Game (USA)${s.extensions[0] ?? ""}`)],
    server: [
      "With retroScaffold on, makes a folder for each system the Switch can run; a deleted one comes back at the next scan. The retro tab lists folders no system reads.",
      BY_HAND,
      TRASH_NOTE,
      README_NOTE,
    ],
    doNotPut: ["ROMs directly here: they belong in a system folder. Drop them in `incoming/<system>/` to have them sorted."],
  })];
  const seen = new Set([out[0].path]);
  for (const [id, s] of Object.entries(systems)) {
    const dir = path.join(roms, s.folder);
    if (seen.has(at(dir))) continue;
    seen.add(at(dir));
    out.push(systemGuide({ id, s, runs: runs.has(id), at: at(dir), dir, pack, bioses }));
  }
  const biosList = biosIds.map((id) => ({ system: id, name: systems[id].names?.en ?? id, ...biosFiles(id) }));
  out.push(guide(bioses, biosDir, {
    role: "bios",
    title: `RetroArch BIOS (${bioses})`,
    purpose: ["RetroArch on the console reads BIOS and firmware files from here; the server sends this folder to each console with the RetroArch pack."],
    consolePath: "sdmc:/retroarch/system/",
    bios: biosList,
    // One line per system, its groups after one another, so the guide stays short as bios.js grows.
    holds: biosList.map((b) => `${b.name} (\`${b.system}\`): ${biosLines(b, "").map((l) => l.replace(/^BIOS, /, "")).join(" ")}`),
    structure: ["system/", ...biosList.map((b) => b.required[0]?.[0]?.file).filter(Boolean).map((file) => `  ${file}`)],
    naming: ["File names must match exactly, with the folder in front when one is shown. A required group is met by any one of its files."],
    server: [
      "Ships no BIOS of its own: the files are copyrighted. The retro tab lists the ones missing for systems that have games.",
      "Sends every file here to the consoles and never renames or deletes one. A file it knows by md5 under another name also goes, once, as the name the core reads. A README.md at the top stays on the server.",
    ],
    doNotPut: [`Cores: \`${pack}/cores/\`.`, "ROMs: `retro/roms/`."],
  }));
  const thumbs = path.join(retroDir, "thumbnails");
  out.push(guide(at(thumbs), thumbs, {
    role: "thumbnails",
    title: "Retro box art (thumbnails)",
    purpose: ["The retro catalog shows box art from here, in the libretro-thumbnails layout."],
    accepts: [".png", ".jpg"],
    holds: ["`<system folder>/Named_Boxarts/<ROM name>.png` (or .jpg). <system folder> is the system's folder under roms/."],
    structure: ["thumbnails/", ...Object.values(systems).slice(0, 2).map((s) => `  ${s.folder}/Named_Boxarts/Some Game (USA).png`)],
    naming: ["<ROM name> is the ROM's file name without its extension; the characters & * / : ` < > ? \\ | \" in it may be written as _."],
    server: [
      "Downloads missing box art when an admin starts it on the retro tab, and at start shrinks large covers here in place.",
      TRASH_NOTE,
    ],
    doNotPut: ["Bezels: `retro/bezels/`.", "ROMs."],
  }));
  const bezels = path.join(retroDir, "bezels");
  out.push(guide(at(bezels), bezels, {
    role: "bezels",
    title: "Retro bezels (bezels)",
    purpose: ["The picture around the game screen on the console, per game or per system."],
    accepts: [".png", ".cfg"],
    holds: ["`<system folder>/<ROM name>.png`, with its `.cfg` and `_override.cfg` beside it.", "`<system folder>/_default.png`: every game of the system without a bezel of its own."],
    structure: ["bezels/", ...Object.values(systems).slice(0, 1).flatMap((s) => [`  ${s.folder}/_default.png`, `  ${s.folder}/Some Game (USA).png`])],
    naming: ["<ROM name> is the ROM's file name without its extension."],
    server: ["Downloads bezels from The Bezel Project when an admin starts it on the retro tab.", TRASH_NOTE],
    doNotPut: ["Box art: `retro/thumbnails/`.", "ROMs."],
  }));
  return out;
}

/**
 * Every folder's guide: the role folders' and the retro folder's own. `systems` is the table the
 * scan reads with, `runnable` the ids the Switch can run, `packDir` the RetroArch pack folder.
 */
export function folderGuides({ layout, systems, runnable = [], retroDir, packDir }) {
  const roles = [];
  for (const [role, make] of Object.entries(ROLES)) {
    const dir = layout?.dirs?.[role];
    if (!dir) continue;
    const at = rolePath(layout, dir);
    roles.push(guide(at, dir, { role, ...make({ systems, at, pack: rolePath(layout, packDir) }) }));
  }
  return [...roles, ...retroGuides({ layout, systems, runnable, retroDir, packDir })];
}

const ROLE_TEXT = {
  incoming: "Drop box. Files left here are sorted into the folders below once they stop changing. Retro ROMs go in a folder named after their system (incoming/snes/Game.zip).",
  games: "Switch games (.nsp .nsz .xci .xcz), one folder per game with update/ and DLC/ inside.",
  homebrew: "Homebrew apps: .nro files and app folders.",
  retro: "Retro ROMs, their art and the RetroArch pack (see below).",
  patches: "Patches, one folder per base title id.",
  saves: "Save files, one folder per title id.",
  keys: "Your own prod.keys.",
  data: "Accounts, settings and caches. Back this one up.",
};

const cell = (s) => String(s).replaceAll("|", "\\|");

/** The storage guide: every folder at a glance and each runnable system's folder, extensions and BIOS. */
export function storageText({ systems, runnable, layout, retroDir, packDir }) {
  const at = (abs) => `${rolePath(layout, abs)}/`;
  const r = at(retroDir);
  const roles = Object.keys(ROLE_TEXT).filter((role) => layout?.dirs?.[role]);
  return [
    "# CookingFoil storage",
    "",
    "A CookingFoil server reads these folders. Paths are relative to the storage folder; the server writes no guide file into any of them.",
    "",
    "## Folders",
    "",
    "| Folder | Where | Holds |",
    "|---|---|---|",
    ...roles.map((role) => `| \`${role}/\` | \`${cell(layout.dirs[role])}\` | ${ROLE_TEXT[role]} |`),
    "",
    "## Retro systems",
    "",
    `ROMs go in \`${r}roms/<folder>/\`, loose or one subfolder deep. Only the systems the Switch can run are listed.`,
    `BIOS files go in \`${at(path.join(packDir, "system"))}\`.`,
    "",
    "| System | Id | Folder | Extensions | BIOS |",
    "|---|---|---|---|---|",
    ...runnable.map((id) => {
      const s = systems[id];
      return `| ${cell(s.names?.en ?? id)} | ${id} | \`${cell(`${r}roms/${s.folder}/`)}\` | ${s.extensions.join(" ")} | ${biosText(id) ?? "none"} |`;
    }),
    "",
    `A folder named the way other front ends name a system (SNES, psx, genesis, "Nintendo - Game Boy Advance") is read in place of the folder above.`,
    `Arcade sets keep their FBNeo short names (sf2.zip). A ScummVM game is a folder holding \`<id>.scummvm\`. Discs of one game keep "(Disc 1)", "(Disc 2)" in their names; .cue and .m3u files bring the tracks they list.`,
    "",
    "## Art and metadata",
    "",
    `- \`${r}thumbnails/<folder>/Named_Boxarts/<ROM name>.png\`: box art, libretro-thumbnails layout.`,
    `- \`${r}bezels/<folder>/<ROM name>.png\`: bezel; \`_default.png\` serves the whole system.`,
    `- \`${r}system-icons/color/<folder>.png\`, \`${r}system-icons/mono/<folder>.png\`: system icons.`,
    `- \`${r}art-map/<id>.json\`, \`${r}ratings.json\`, \`${r}arcade-names.json\`: original titles and ratings.`,
    `- \`${r}systems.json\`: changes a system (folder, core, extensions) or adds one.`,
    `- \`${at(packDir)}\`: the RetroArch pack (retroarch.nro, cores/, system/). ${CORE_NOTE}`,
    "",
    "## What the server does here",
    "",
    "- It makes missing folders: the folders above, a ROM folder for each system listed, and the BIOS folder.",
    "- It never renames, moves or deletes files or folders to do so.",
    "- Other changes happen only on request: files left in the drop box are sorted into the folders above, and the admin page renames or deletes what an admin picks. NSZ conversion, when an admin turns it on, replaces .nsp files with .nsz.",
    `- ${TRASH_NOTE}`,
    "- A deleted folder comes back at the next scan. To stop that, turn off the folder making (retroScaffold) in the admin page's server settings.",
    `- ${README_NOTE}`,
    `- Each folder above, each system folder, the BIOS folder, thumbnails/ and bezels/ have a guide of their own. ${ENDPOINT}`,
    "",
  ].join("\n");
}
