/**
 * RetroArch core capabilities: one core's files from the base pack, and the core upkeep
 * (src/retro/auto-cores.js) that fetches missing cores and updates the server's own from the
 * libretro nightly buildbot. Switching a user's core to the official build and back moves the
 * user's file to or from the trash, so those two routes are token-blocked (opt-out.js). Also
 * what the library's retro games need from the pack (retro_requirements), and the Korean titles
 * the bundled dictionary gives retro games by content hash or, for the admin to decide, by title.
 */
import { defineCapability } from "./define.js";

const CORE_ARG = {
  type: "string",
  description: "Core id as in the file name before _libretro_libnx.nro, e.g. snes9x or mgba",
};

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
    description: "Per system with games: the core each one needs and whether the pack has it, and the BIOS files present, missing or a different dump.",
    input: { type: "object", properties: {} },
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro/requirements" },
    handler: async () => {
      const { retroRequirements } = await import("../routes/admin/retro-art-api.js");
      return retroRequirements();
    },
  }),
  defineCapability({
    id: "retro_ko_names",
    area: "retro",
    title: "Korean titles of retro games",
    description: "Lists retro games named in Korean by their ROM content hash, and title-only guesses waiting for approval, with hash index counts.",
    input: { type: "object", properties: {} },
    safety: "read",
    http: { method: "GET", path: "/admin/api/retro-ko" },
    handler: async () => {
      const { retroKoReview } = await import("../routes/admin/retro-ko-api.js");
      return retroKoReview();
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
