/** The console client's version from its `Version` header, cleaned for a log line, or null when it sent none. */
export function clientVersionOf(req) {
  const raw = req?.get?.("Version") ?? req?.headers?.version ?? "";
  return String(raw).replace(/[^\w.+-]/g, "").slice(0, 40) || null;
}
