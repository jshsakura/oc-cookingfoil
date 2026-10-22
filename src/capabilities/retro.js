/**
 * Retro capabilities: what the library's retro games need from the RetroArch pack.
 */
import { defineCapability } from "./define.js";

export const retroCapabilities = [
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
];
