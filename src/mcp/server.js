/**
 * The MCP server: one McpServer per request (createMcpHandler, stateless). help is a tool of its own;
 * every other served capability is an action of its area's tool (tools.js). The SDK checks the area
 * tool's shape, and the action's own input schema is checked here before its handler runs; a bad
 * call comes back as an isError result naming the argument.
 *
 * Writing actions take confirm: "approve" (as ServiceNow MCP does). Without it the call changes
 * nothing and returns the capability's preview, which the agent shows the user; it calls again with
 * confirm only after the user agrees. Each carried-out write is journaled.
 */
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import pkg from "../app-info.js";
import { errorResult, okResult } from "./envelope.js";
import { reference } from "./spec.js";
import { areaDescription, areaInput, areaTools, gated, servedTools, STANDALONE } from "./tools.js";
import { record } from "./journal.js";

const INSTRUCTIONS = "CookingFoil, a Nintendo Switch library server. Each tool is an area; pick what it does with action and pass that action's arguments in args. Call help first: rules, id formats and every action's arguments and result. help with tool (an action or area name) gives its full spec.";

const NEXT = "Nothing changed yet. Tell the user what this would do, then call again with confirm='approve' only if they agree.";

// Compiled once: the schemas never change while the server runs.
const schemas = new Map();
const compiled = (key, schema) => {
  if (!schemas.has(key)) schemas.set(key, fromJsonSchema(schema));
  return schemas.get(key);
};
const badInput = (message) => Object.assign(new Error(message), { status: 400 });

async function argsOf(cap, args) {
  if (args && Object.hasOwn(args, "confirm")) throw badInput("confirm goes next to action, not inside args");
  const checked = await compiled(cap.id, cap.input)["~standard"].validate(args);
  if (checked.issues) throw badInput(`${cap.id}: ${checked.issues.map((i) => i.message).join("; ")}`);
  return checked.value;
}

async function call(cap, ctx, input, confirm) {
  if (!gated(cap)) return cap.handler(ctx, input);
  if (confirm !== "approve") return { preview: await cap.preview(ctx, input), next: NEXT };
  try {
    const result = await cap.handler(ctx, input);
    record({ tool: cap.id, token: ctx.token?.id ?? null, by: ctx.by?.name ?? null, input, ok: true });
    return result;
  } catch (err) {
    record({ tool: cap.id, token: ctx.token?.id ?? null, by: ctx.by?.name ?? null, input, ok: false, error: err.message });
    throw err;
  }
}

/** A server for one caller. `ctx` reaches every handler: { token: { id, label, owner }, by }. */
export function buildServer(ctx) {
  const server = new McpServer({ name: "cookingfoil", version: pkg.version }, { instructions: INSTRUCTIONS });
  for (const cap of servedTools().filter((c) => STANDALONE.has(c.id))) {
    server.registerTool(cap.id, { title: cap.title, description: cap.description, inputSchema: compiled(`tool:${cap.id}`, cap.input), annotations: { readOnlyHint: true } }, async (args) => {
      try {
        return okResult(await call(cap, ctx, args ?? {}));
      } catch (err) {
        return errorResult(err, cap.id);
      }
    });
  }
  for (const area of areaTools()) {
    const writes = area.caps.some(gated);
    const annotations = writes ? { readOnlyHint: false, destructiveHint: false } : { readOnlyHint: true };
    server.registerTool(area.name, { description: areaDescription(area), inputSchema: compiled(`area:${area.name}`, areaInput(area)), annotations }, async ({ action, args, confirm } = {}) => {
      const cap = area.caps.find((c) => c.id === action);
      try {
        return okResult(await call(cap, ctx, await argsOf(cap, args ?? {}), confirm));
      } catch (err) {
        return errorResult(err, action);
      }
    });
  }
  server.registerResource("reference", "cookingfoil://reference", { title: "CookingFoil reference", description: "What the help tool returns without arguments", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: reference() }],
  }));
  return server;
}

/** authInfo is the token route.js verified: { clientId: token id, extra: { label } }. */
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const token = { id: authInfo?.clientId ?? null, label: authInfo?.extra?.label ?? "", owner: authInfo?.extra?.owner ?? null };
  return buildServer({ token, by: { type: "token", name: token.label || token.id || "mcp" } });
});
