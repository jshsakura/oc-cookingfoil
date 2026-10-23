import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Its own process: the other MCP tests load the SDK at the top.
test("mounting /mcp with MCP off loads no MCP SDK", () => {
  const script = `
    import { registerHooks } from "node:module";
    const seen = [];
    registerHooks({ resolve(spec, ctx, next) { seen.push(spec); return next(spec, ctx); } });
    const { mcpRoute } = await import("./src/mcp/route.js");
    mcpRoute();
    process.stdout.write(String(seen.some((s) => s.includes("@modelcontextprotocol") || s.endsWith("/server.js") && s.includes("mcp"))) + " " + seen.length);`;
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), env: { ...process.env, COOK_MCP_ENABLED: "false" }, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const [sdk, count] = out.stdout.split(" ");
  assert.ok(Number(count) > 3, "the hook saw the route's imports");
  assert.equal(sdk, "false");
});
