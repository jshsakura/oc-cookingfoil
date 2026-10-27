/**
 * Keys for outside services (IGDB, SteamGridDB, RetroAchievements, Dropbox, GitHub): whether each is
 * set, a test against the service, and forgetting a key. Saving a key is not a tool: the key would
 * have to pass through a chat. Telegram has its own tools (alerts_*). The save and clear routes
 * refuse tokens only for telegram; the others are plain token routes, so these are not mcp-only.
 */
import { defineCapability } from "./define.js";
import { arr, bool, nullable, obj, oneOf, str } from "./shape.js";
import * as integrations from "../security/integrations.js";
import { testIntegration } from "../routes/admin/integrations-api.js";

const SERVICES = Object.keys(integrations.SERVICES).filter((s) => s !== "telegram" && s !== "chat");
const OPS = ["test", "clear"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const SAID = {
  noKey: "No key is set for that service",
  noTest: "This service has no test; the key is set",
  connected: "The service accepted the key",
  keyRefused: "The service refused the key",
  unreachable: "The service could not be reached",
};

function serviceOf(input) {
  if (!OPS.includes(input.op)) throw fail(400, `op is one of ${OPS.join(", ")}`);
  if (!SERVICES.includes(input.service)) throw fail(400, `service is one of ${SERVICES.join(", ")}`);
  return input.service;
}

export const integrationsCapabilities = [
  defineCapability({
    id: "integration_list",
    area: "admin",
    title: "List outside service keys",
    description: "Which outside services have keys (IGDB, SteamGridDB, RetroAchievements, Dropbox, GitHub), whether each is set and where it came from. Key values are never shown.",
    input: { type: "object", properties: {} },
    output: obj({ services: arr(obj({ service: str(), configured: bool("every needed key is set"), source: oneOf(["admin", "env", "none"], "admin saved on the admin page; env from the compose file") })) }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/integrations" },
    handler: async () => {
      const all = integrations.describe();
      return { services: SERVICES.map((service) => ({ service, configured: all[service].configured, source: all[service].source })) };
    },
  }),
  defineCapability({
    id: "integration_set",
    area: "admin",
    title: "Test or forget a service key",
    description: "op test tries the stored key against the service; op clear forgets the key saved on the admin page, so the compose value applies again. Keys are entered on the admin page.",
    input: {
      type: "object",
      properties: {
        service: { type: "string", enum: SERVICES, description: "The service whose key to use: igdb, steamgriddb, retroAchievements, dropbox or github" },
        op: { type: "string", enum: OPS, description: "test tries the key now; clear forgets the key saved on the admin page" },
      },
      required: ["service", "op"],
    },
    output: obj({ done: oneOf(OPS), service: str(), ok: bool(), message: nullable(str()) }),
    preview: async (_ctx, input) => {
      const service = serviceOf(input);
      const d = integrations.describe()[service];
      return {
        service, op: input.op, configured: d.configured, source: d.source,
        changes: input.op === "test" ? "Makes one small request to the service with the stored key. Nothing is changed." : d.source === "admin" ? "Forgets the key saved on the admin page. Features that need it stop until a key is entered again, or the compose value applies if there is one." : "Nothing saved on the admin page to forget.",
      };
    },
    previewOutput: obj({ service: str(), op: str(), configured: bool(), source: str(), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/integrations/:service/test" },
    also: ["POST /admin/api/integrations/:service/clear"],
    handler: async (_ctx, input) => {
      const service = serviceOf(input);
      if (input.op === "clear") {
        integrations.clear(service);
        return { done: "clear", service, ok: true, message: null };
      }
      const outcome = await testIntegration(service);
      return { done: "test", service, ok: outcome.ok, message: SAID[outcome.reason] ?? outcome.reason };
    },
  }),
];
