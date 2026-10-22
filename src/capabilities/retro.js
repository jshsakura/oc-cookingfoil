/**
 * RetroArch core capabilities: one core's files from the base pack, and the core upkeep
 * (src/retro/auto-cores.js) that fetches missing cores and updates the server's own from the
 * libretro nightly buildbot. Switching a user's core to the official build and back moves the
 * user's file to or from the trash, so those two routes are token-blocked (opt-out.js).
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
];
