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
  current: nullable(int("steps done")),
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
    description: "Without tool: rules, id formats, and each area tool with one line per action (arguments and result). With tool: that action's full input and output, or that area's actions.",
    input: {
      type: "object",
      properties: {
        tool: { type: "string", description: "An action such as games_search, or an area tool such as games" },
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
    http: { method: "GET", path: "/admin/api/activity" },
    token: true,
    handler: async () => (await import("../tasks/activity.js")).list(),
  }),
  defineCapability({
    id: "server_overview",
    area: "jobs",
    title: "Server overview",
    description: "What needs the admin now (warnings, damaged files, consoles waiting, inbox, failing plugins), how the server stands, the newest games, patches and alerts. Start here.",
    input: { type: "object", properties: {} },
    output: obj({
      generatedAt: num("epoch ms"),
      todo: arr(obj({ code: str("what needs doing, such as damaged, pending-devices, inbox or a config warning code"), n: int("how many, when it is a count") }, { optional: ["n"] })),
      status: obj({}),
      recent: arr(obj({ at: num("epoch ms"), event: str(), text: str("the first line of the alert"), status: str("sent, failed, held or off") }), "newest first"),
      added: obj({}),
    }),
    safety: "read",
    http: { method: "GET", path: "/admin/api/overview" },
    token: true,
    handler: async () => (await import("../routes/admin/overview-api.js")).readOverview(),
  }),
  defineCapability({
    id: "job_cancel",
    area: "jobs",
    title: "Stop a running job",
    description: "Asks a running background job to stop. Only jobs listed as cancellable by jobs_list can; a job stops at its next safe point.",
    input: {
      type: "object",
      properties: { id: { type: "string", description: "The job id from jobs_list; the job must be running and cancellable" } },
      required: ["id"],
    },
    output: obj({ stopping: bool(), id: str() }),
    preview: async (_ctx, input) => {
      const job = (await import("../tasks/activity.js")).list().running.find((j) => j.id === input.id);
      if (!job) throw Object.assign(new Error(`no running job ${input.id}; jobs_list shows them`), { status: 404 });
      return { job: { id: job.id, kind: job.kind, title: job.title, cancellable: job.cancellable }, changes: job.cancellable ? "Asks it to stop. Work already done stays done." : "It cannot be stopped; it runs to the end." };
    },
    previewOutput: obj({ job: obj({ id: str(), kind: str(), title: str(), cancellable: bool() }), changes: str() }),
    safety: "write",
    http: { method: "POST", path: "/admin/api/activity/:id/cancel" },
    handler: async (_ctx, input) => {
      if (!(await import("../tasks/activity.js")).cancel(String(input.id))) throw Object.assign(new Error(`job ${input.id} is not running or cannot be stopped`), { status: 404 });
      return { stopping: true, id: input.id };
    },
  }),
];
