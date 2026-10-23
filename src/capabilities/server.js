/**
 * Capabilities about the server itself: the agent reference (help) and the jobs it runs.
 * Neither has an admin route of its own: the admin page shows jobs on /api/activity, which
 * automation tokens do not reach, so both are opened to tokens here (token: true).
 */
import { defineCapability } from "./define.js";
import { arr, bool, int, nullable, num, obj, str } from "./shape.js";

const JOB = obj({
  id: str(),
  kind: str("what kind of work, such as scan:games, nsz, backup or retro-art"),
  title: str("the admin page's label, in Korean"),
  detail: nullable(str()),
  current: int("steps done"),
  total: nullable(int("steps in all, when known")),
  startedAt: num("epoch ms"),
  state: str("running, done, failed or stopped"),
  cancellable: bool(),
  stopping: bool("asked to stop and still running"),
  result: nullable(str("what a finished job reported")),
  error: str("why a failed job failed"),
  endedAt: num("epoch ms"),
}, { optional: ["stopping", "result", "error", "endedAt"] });

export const serverCapabilities = [
  defineCapability({
    id: "help",
    area: "server",
    title: "CookingFoil reference",
    description: "Without tool: rules, id formats and one line per tool (arguments and result). With tool: that tool's full input and output spec.",
    input: {
      type: "object",
      properties: {
        tool: { type: "string", description: "A tool name from the index, such as games_search, to get its full input and output spec" },
      },
    },
    output: obj({ text: str("Markdown") }),
    safety: "read",
    token: true,
    handler: async (_ctx, input) => {
      const { reference, toolSpec } = await import("../mcp/spec.js");
      return { text: input?.tool ? toolSpec(input.tool) : reference() };
    },
  }),
  defineCapability({
    id: "jobs_list",
    area: "jobs",
    title: "Running and recent jobs",
    description: "Lists background jobs: running ones with progress, and recently finished ones with their result or error. Use after starting a job.",
    input: { type: "object", properties: {} },
    output: obj({ running: arr(JOB), recent: arr(JOB, "newest first, kept for a while after they end") }),
    safety: "read",
    token: true,
    handler: async () => (await import("../tasks/activity.js")).list(),
  }),
];
