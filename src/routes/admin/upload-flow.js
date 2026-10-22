/**
 * The admin upload page's batch bookkeeping, kept pure so it can be tested. The dashboard inlines
 * each function with Function#toString, so every one uses nothing outside itself.
 */

/**
 * How a picked set is sent: [{ label, from }], `from` the indexes into the picked files.
 * Packages go one request each (the server takes one per request); anything else, a folder
 * included, is one request so its parts land together.
 */
export function splitUnits({ kind, names, paths = null }) {
  if (!names.length) return [];
  if (kind === "game" && names.length > 1 && !paths) return names.map((n, i) => ({ label: n, from: [i] }));
  const all = names.map((_, i) => i);
  if (paths) return [{ label: `${paths[0].split("/")[0]}/ · ${names.length}`, from: all }];
  if (names.length === 1) return [{ label: names[0], from: all }];
  return [{ label: `${names[0]} +${names.length - 1}`, from: all }];
}

/** The units still to send: everything that has not gone in. */
export function unitsToSend(units) {
  return units.filter((u) => u.state !== "ok");
}

/** { ok, fail, wait } over a batch; a unit that is sending counts as waiting. */
export function tally(units) {
  const t = { ok: 0, fail: 0, wait: 0 };
  for (const u of units) t[u.state === "ok" ? "ok" : u.state === "fail" ? "fail" : "wait"]++;
  return t;
}

/** Which note explains a failed answer: dup (name taken), net (no answer) or null (show the server's words). */
export function failureKind(status, message) {
  if (!status) return "net";
  if (status === 409 && /^이미 있습니다/.test(message ?? "")) return "dup";
  return null;
}
