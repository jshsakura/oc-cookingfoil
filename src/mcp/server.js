/**
 * The MCP server: one McpServer per request (createMcpHandler, stateless), its tools the served
 * capabilities (tools.js). The SDK checks arguments against each capability's input schema before
 * the handler runs; a bad call comes back as an isError result naming the argument.
 *
 * Write and destructive tools take confirm: "approve" (as ServiceNow MCP does). Without it the
 * call changes nothing and returns the capability's preview, which the agent shows the user; it
 * calls again with confirm only after the user agrees. Each carried-out write is journaled.
 */
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import pkg from "../package.js";
import { errorResult, okResult } from "./envelope.js";
import { reference } from "./spec.js";
import { gated, servedTools, toolDescription, toolInput } from "./tools.js";
import { record } from "./journal.js";

const INSTRUCTIONS = "CookingFoil, a Nintendo Switch library server. Call help first: rules, id formats and every tool's arguments and result. help with tool gives one tool's full spec.";

const ANNOTATIONS = {
  read: { readOnlyHint: true },
  write: { readOnlyHint: false, destructiveHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true },
};

const NEXT = "Nothing changed yet. Tell the user what this would do, then call again with confirm='approve' only if they agree.";


// Compiled once: the schemas never change while the server runs.
const inputSchemas = new Map();
const inputSchemaOf = (cap) => {
  if (!inputSchemas.has(cap.id)) inputSchemas.set(cap.id, fromJsonSchema(toolInput(cap)));
  return inputSchemas.get(cap.id);
};

async function call(cap, ctx, args) {
  if (!gated(cap)) return cap.handler(ctx, args);
  const { confirm, ...input } = args;
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

/** A server for one caller. `ctx` reaches every handler: { token: { id, label }, by }. */
export function buildServer(ctx) {
  const server = new McpServer({ name: "cookingfoil", version: pkg.version }, { instructions: INSTRUCTIONS });
  for (const cap of servedTools()) {
    server.registerTool(cap.id, { title: cap.title, description: toolDescription(cap), inputSchema: inputSchemaOf(cap), annotations: ANNOTATIONS[cap.safety] }, async (args) => {
      try {
        return okResult(await call(cap, ctx, args ?? {}));
      } catch (err) {
        return errorResult(err, cap.id);
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
  const token = { id: authInfo?.clientId ?? null, label: authInfo?.extra?.label ?? "" };
  return buildServer({ token, by: { type: "token", name: token.label || token.id || "mcp" } });
});
