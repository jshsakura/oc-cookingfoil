/**
 * RetroArch core capabilities: one core's files from the base pack, and the core upkeep
 * (src/retro/auto-cores.js) that fetches missing cores and updates the server's own from the
 * libretro nightly buildbot. Switching a user's core to the official build and back moves the
 * user's file to or from the trash, so those two routes are token-blocked (opt-out.js). Also
 * what the library's retro games need from the pack (retro_requirements), and the Korean titles
 * the bundled dictionary gives retro games by content hash or, for the admin to decide, by title.
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, oneOf, str } from "./shape.js";
import { leanCores, leanKoNames, leanRequirements } from "./lean.js";

const CORE_ARG = {
  type: "string",
  description: "Core id as in the file name before _libretro_libnx.nro, e.g. snes9x or mgba",
};

const KO_ROW = obj({
  id: str("retro game id"),
  system: str(),
  ko: str("Korean title"),
  en: nullable(str()),
  by: str("how it was matched"),
});

const PATCH_ROW = obj({
  id: str("retro game id"),
  system: str(),
  systemName: str(),
  name: str("name from the file"),
  file: str("ROM file name"),
  size: nullable(int("bytes; null when the game left the catalog")),
  unpatchable: oneOf(["arcade", "multi-file"], "why the game takes no patch"),
  missing: bool("patched, but no longer in the catalog"),
  patch: obj({
    patches: arr(obj({ name: str("patch file name"), format: oneOf(["ips", "bps", "ups", "xdelta"]), verified: bool("source and result checksums matched"), at: str("ISO time") })),
    backup: str("original's path under the retro folder"),
    original: obj({ size: int("bytes") }),
  }, { description: "patches the admin applied on the server, oldest first" }),
}, { optional: ["unpatchable", "missing", "patch"] });

/** An input the route would answer 400; MCP reports it as BAD_INPUT. */
const badInput = (message) => Object.assign(new Error(message), { status: 400 });

/** A started job as the admin route shows it, without its promise. */
const shown = ({ done: _done, ...rest }) => rest;

export const retroCapabilities = [
  defineCapability({
    id: "retro_core_files",
    area: "retro",
    title: "Get one RetroArch core's files",
    description: "Lists one core's .nro and .info in the RetroArch base pack with size, sha256 and url. Empty when the pack has no such core.",
    input: { type: "object", properties: { core: CORE_ARG }, required: ["core"] },
    safety: "read",
    http: { method: "GET", path: "/api/retro/base-pack/core/:core" },
    handler: async (_ctx, { core }) => {
      const { baseCoreFiles } = await import("../routes/retro.js");
      const files = await baseCoreFiles(core);
      return files === null ? { pending: true, retryAfter: 30 } : { core, files };
    },
  }),
  defineCapability({
    id: "retro_cores_fetch_missing",
    area: "retro",
    title: "Fetch missing RetroArch cores",
    description: "Starts one job that fetches the missing cores of consoles with games from the libretro nightly buildbot. Writes only new files.",
    input: { type: "object", properties: {} },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-cores/auto" },
    handler: async () => {
      const [{ autoCores }, catalog, envs] = await Promise.all([import("../retro/auto-cores.js"), import("../retro/catalog.js"), import("../helpers/envs.js")]);
      return shown(await (await autoCores()).check(await catalog.current(envs.retroDir), { force: true }));
    },
  }),
  defineCapability({
    id: "retro_cores",
    area: "retro",
    title: "List RetroArch cores and their settings",
    description: "One line per core (size, origin, on/off) and per console (core, upkeep state). With core: that core's whole row and consoles. Read before changing a core.",
    input: { type: "object", properties: { core: { ...CORE_ARG, description: "One core id, for its whole row and its consoles; leave out for the one-line list" } } },
    output: obj({
      official: str("the libretro RetroArch version the server pins"),
      retroarch: nullable({ type: "object", description: "retroarch_switch.nro in the pack: size, sha256, modifiedAt, origin" }),
      cores: arr(obj({
        core: str("core id, as the core tools take it"),
        size: int("bytes"),
        origin: oneOf(["official", "modified", "extra"], "against the pinned official build; modified and extra are never replaced"),
        off: bool("switched off: left out of the console pack, its games listed with coreOff"),
        systems: arr(str("retro system id"), "consoles whose games start with it"),
      }, { optional: ["off"] }), "one line a core; absent with core"),
      systems: arr(obj({
        id: str("retro system id"),
        games: int(),
        core: nullable(str("core its games start with")),
        installed: nullable(bool("that core is in the pack")),
        state: nullable(str("the upkeep's word on that core")),
      }, { optional: ["games", "core", "installed", "state"], description: "with core: the whole console rows instead (name, fits, others, coreState)" }), "one line a console"),
      core: { type: "object", description: "with core: the whole row, with file, name, sha256, modifiedAt, origin, off and systems" },
      sources: obj({ repo: nullable(str("owner/name read by source repo")), custom: arr(str(), "cores with a source other than the nightly buildbot") }),
      auto: obj({ enabled: bool("automatic core upkeep is on"), hidden: int("user cores held aside for the admin") }),
    }, { optional: ["cores", "core"] }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-cores" },
    handler: async (_ctx, input = {}) => {
      const { retroCoresView } = await import("../routes/admin/retro-cores-api.js");
      return leanCores(await retroCoresView(), input.core);
    },
  }),
  defineCapability({
    id: "retro_core_enabled",
    area: "retro",
    title: "Switch a RetroArch core on or off",
    description: "Switches a core on or off for every console. Off: it leaves the console pack and is not fetched; its games stay listed with coreOff and refuse downloads (409).",
    input: { type: "object", properties: { core: { type: "string", description: "The core id as in its file name, e.g. mgba for mgba_libretro_libnx.nro" }, enabled: { type: "boolean", description: "true switches the core on again, false switches it off for every console" } }, required: ["core", "enabled"] },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-cores/enabled" },
    handler: async (_ctx, { core, enabled }) => {
      const coreSettings = await import("../retro/core-settings.js");
      if (typeof enabled !== "boolean" || !coreSettings.setEnabled(core, enabled)) throw badInput("core and enabled (true/false) are required");
      return { core, enabled };
    },
  }),
  defineCapability({
    id: "retro_core_source",
    area: "retro",
    title: "Choose where a RetroArch core comes from",
    description: "Sets where the core upkeep takes one core: nightly buildbot (default), repo (latest release of the retro_core_repo repository) or upload (never fetched or replaced).",
    input: {
      type: "object",
      properties: {
        core: { type: "string", description: "The core id as in its file name, e.g. mgba for mgba_libretro_libnx.nro" },
        source: { type: "string", enum: ["nightly", "repo", "upload"], description: "nightly, repo (set the repository with retro_core_repo first) or upload (the admin's own file)" },
      },
      required: ["core", "source"],
    },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-cores/source" },
    handler: async (_ctx, { core, source }) => {
      const coreSettings = await import("../retro/core-settings.js");
      if (!coreSettings.setSource(core, source)) throw badInput("core and source (nightly, repo, upload) are required");
      return { core, source };
    },
  }),
  defineCapability({
    id: "retro_core_repo",
    area: "retro",
    title: "Set the RetroArch core repository",
    description: "Sets the GitHub repository whose latest release supplies <core>_libretro_libnx.nro (or .nro.zip) to cores with source repo. An empty repo clears it.",
    input: { type: "object", properties: { repo: { type: "string", description: "owner/name of a GitHub repository with Switch core releases, e.g. owner/switch-cores; empty clears it" } }, required: ["repo"] },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-cores/repo" },
    handler: async (_ctx, { repo }) => {
      const coreSettings = await import("../retro/core-settings.js");
      if (typeof repo !== "string" || !coreSettings.setRepo(repo)) throw badInput("not an owner/name repository");
      return { repo: coreSettings.repo() };
    },
  }),
  defineCapability({
    id: "retro_cores_update",
    area: "retro",
    title: "Update the server's RetroArch cores",
    description: "Starts one job replacing each core the server placed whose nightly CRC-32 changed. A user's own core is never touched.",
    input: { type: "object", properties: {} },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-cores/update" },
    handler: async () => {
      const { autoCores } = await import("../retro/auto-cores.js");
      const job = (await autoCores()).update();
      return { started: true, kind: job.kind, cores: [...job.cores], startedAt: job.startedAt };
    },
  }),
  defineCapability({
    id: "retro_requirements",
    area: "retro",
    title: "Cores and BIOS the retro games need",
    description: "Systems missing a core or BIOS, or with a BIOS to check, whole; the ids of the rest. With system: that one whole.",
    input: { type: "object", properties: { system: { type: "string", description: "One retro system id, such as gba, for its whole row; leave out for the ones with problems" } } },
    output: obj({
      retroarch: oneOf(["installed", "missing"], "retroarch.nro in the pack"),
      complete: bool("no system misses anything or has anything to check"),
      systems: arr(obj({
        id: str("retro system id"),
        names: { type: "object", description: "the system's name by language, en at least" },
        games: int(),
        missing: int("required BIOS files and arcade zips not there"),
        check: int("required BIOS files there but of another dump"),
        cores: arr(obj({ core: str(), file: str(), state: str("present, missing, or what the core upkeep is doing"), games: int() }, { description: "also server, console, warn, reason and message" })),
        firmware: arr(obj({ files: arr(str()), required: bool(), state: oneOf(["present", "missing", "mismatch"]) })),
        arcade: obj({ sets: int(), missingSets: arr(str()), bios: arr(obj({ zip: str(), state: str() })), parents: arr(obj({ zip: str() })) }, { description: "FBNeo sets, on the arcade system" }),
      }, { optional: ["arcade"] }), "systems with something missing or to check, whole; with system, that one"),
      ok: arr(str("retro system id"), "systems with games and nothing missing"),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro/requirements" },
    handler: async (_ctx, input = {}) => {
      const { retroRequirements } = await import("../routes/admin/retro-art-api.js");
      return leanRequirements(await retroRequirements(), input.system);
    },
  }),
  defineCapability({
    id: "retro_ko_names",
    area: "retro",
    title: "Korean titles of retro games",
    description: "One page of retro games named in Korean: guesses waiting for approval (default) or those named by ROM hash. Counts of both come with it.",
    input: {
      type: "object",
      properties: {
        list: { type: "string", enum: ["guesses", "confirmed"], description: "guesses (default) waits for retro_ko_name_decide; confirmed is named by content hash and needs no decision" },
        q: { type: "string", description: "Part of the Korean title, English title or file name" },
        limit: { type: "integer", description: "How many rows to return; 25 when left out, at most 100" },
        offset: { type: "integer", description: "How many rows to skip, for the next page of the list" },
      },
    },
    output: obj({
      index: obj({ files: int("ROM files"), read: int("ROM files hashed"), skipped: int(), busy: bool("a hashing pass is running") }),
      confirmedTotal: int(),
      guessesTotal: int(),
      list: oneOf(["guesses", "confirmed"]),
      total: int("rows of that list matching q"),
      offset: int(),
      items: arr(KO_ROW, "this page"),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-ko" },
    handler: async (_ctx, input = {}) => {
      const { retroKoReview } = await import("../routes/admin/retro-ko-api.js");
      return leanKoNames(await retroKoReview("ko", Infinity), input);
    },
  }),
  defineCapability({
    id: "retro_ko_name_decide",
    area: "retro",
    title: "Approve or reject a Korean title guess",
    description: "Keeps a title-only Korean name guess as the game's Korean name, or rejects it so it is not suggested again. Hash matches need no decision.",
    input: {
      type: "object",
      properties: {
        game: { type: "string", description: "Retro game id from retro_ko_names guesses, e.g. gba-0123456789" },
        approve: { type: "boolean", description: "true keeps the guessed Korean title, false rejects it for good" },
      },
      required: ["game", "approve"],
    },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-ko/guess" },
    handler: async (_ctx, { game, approve }) => {
      const { decideRetroKoGuess } = await import("../routes/admin/retro-ko-api.js");
      const result = await decideRetroKoGuess(game, approve === true);
      return { ok: result === "ok", result };
    },
  }),
  defineCapability({
    id: "retro_rom_patches",
    area: "retro",
    title: "Retro ROMs patched on the server",
    description: "Lists retro games the admin patched on the server (IPS, BPS, UPS, xdelta) with each patch and its backup, and finds games by name.",
    input: {
      type: "object",
      properties: { q: { type: "string", description: "Part of a game's name or file name to search for; leave empty to list only patched games" } },
    },
    output: obj({ patched: arr(PATCH_ROW, "games carrying a server-applied patch"), games: arr(PATCH_ROW, "up to 50 games matching q") }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-patch" },
    handler: async (_ctx, { q = "" } = {}) => {
      const { retroPatchStatus } = await import("../routes/admin/retro-patch-api.js");
      return retroPatchStatus({ q: String(q).slice(0, 200) });
    },
  }),
  defineCapability({
    id: "retro_ko_index",
    area: "retro",
    title: "Read retro ROM content hashes",
    description: "Starts one background pass reading CRC-32, SHA-1 and SHA-256 of new and changed retro ROM files. ROM files are only read.",
    input: { type: "object", properties: {} },
    safety: "write",
    http: { method: "POST", path: "/admin/api/retro-ko/index" },
    handler: async () => {
      const { startRetroKoIndex } = await import("../routes/admin/retro-ko-api.js");
      return startRetroKoIndex();
    },
  }),
];
