/**
 * The lean views the MCP tools answer with. An agent pays for every byte it reads, so a list tool
 * answers with the few fields it needs to choose from and one page of rows; the full row comes
 * from asking for that one thing (a core, a system). The admin page's routes keep their full answers.
 */

const PAGE = 25;
const PAGE_MAX = 100;

/** A page window from `limit` and `offset`, kept inside what a tool may return. */
export function windowOf(input = {}, page = PAGE, max = PAGE_MAX) {
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit, 1), max) : page;
  const offset = Number.isInteger(input.offset) ? Math.max(input.offset, 0) : 0;
  return { limit, offset };
}

const has = (text, q) => String(text ?? "").toLowerCase().includes(q);

/** retroKoReview() as one page of one list. The default list is the one waiting for a decision. */
export function leanKoNames(review, input = {}) {
  const list = input.list === "confirmed" ? "confirmed" : "guesses";
  const q = String(input.q ?? "").trim().toLowerCase();
  const rows = review[list].filter((g) => !q || has(g.ko, q) || has(g.en, q) || has(g.name, q) || has(g.file, q));
  const { limit, offset } = windowOf(input);
  return {
    index: review.index,
    confirmedTotal: review.confirmedTotal,
    guessesTotal: review.guessesTotal,
    list,
    total: rows.length,
    offset,
    items: rows.slice(offset, offset + limit).map(({ id, system, ko, en, by }) => ({ id, system, ko, en, by })),
  };
}

/** retroCoresView() with one line a core and a console; `core` gives that core whole, with its consoles. */
export function leanCores(view, core) {
  const { official, retroarch, auto, sources } = view;
  const head = { official, retroarch, auto: { enabled: auto?.enabled === true, hidden: auto?.hidden?.length ?? 0 }, sources: { repo: sources?.repo ?? null, custom: Object.keys(sources?.cores ?? {}) } };
  if (core) {
    const row = view.cores.find((c) => c.core === core);
    if (!row) throw Object.assign(new Error(`No core ${core} in the base pack. Cores: ${view.cores.map((c) => c.core).join(", ")}`), { status: 404 });
    return { ...head, core: row, systems: view.systems.filter((s) => s.core === core) };
  }
  return {
    ...head,
    cores: view.cores.map((c) => ({ core: c.core, size: c.size, origin: c.origin, ...(c.off ? { off: true } : {}), systems: c.systems.map((s) => s.id) })),
    systems: view.systems.map((s) => ({ id: s.id, games: s.games, core: s.core, installed: s.installed, state: s.coreState?.state ?? null })),
  };
}

/** retroRequirements() with the consoles that miss or need a check whole and the rest as ids; `system` gives one whole. */
export function leanRequirements(view, system) {
  const { retroarch, complete, systems } = view;
  if (system) {
    const row = systems.find((s) => s.id === system);
    if (!row) throw Object.assign(new Error(`No system ${system} with games. Systems: ${systems.map((s) => s.id).join(", ")}`), { status: 404 });
    return { retroarch, complete, systems: [row], ok: [] };
  }
  const problem = (s) => s.missing > 0 || s.check > 0;
  return { retroarch, complete, systems: systems.filter(problem), ok: systems.filter((s) => !problem(s)).map((s) => s.id) };
}

/** trash.list() with a line an entry (what it was, how big, how old) and one page of them. */
export function leanTrash(list, input = {}) {
  const { limit, offset } = windowOf(input, 20, 200);
  return {
    total: list.total,
    roots: list.roots,
    old: list.old,
    noticeDays: list.noticeDays,
    ...(list.unavailable?.length ? { unavailable: list.unavailable } : {}),
    offset,
    items: list.items.slice(offset, offset + limit).map((e) => ({
      id: e.id, root: e.root, kind: e.kind, name: e.name, size: e.size, trashedAt: e.trashedAt, ageDays: e.ageDays, files: e.items?.length ?? 0,
      ...(e.missing ? { missing: e.missing } : {}), ...(e.incomplete ? { incomplete: e.incomplete } : {}),
    })),
  };
}

/** device_list() with a line a console; when it was added stays on the admin page, who added it does not. */
export function leanDevices(list) {
  return {
    waiting: list.waiting,
    downloads: list.downloads,
    sends: list.sends,
    owners: list.owners,
    approved: list.approved.map(({ code, label, admin, addedBy, lastSeenAt }) => ({ code, label, admin, addedBy, lastSeenAt })),
  };
}

/** account_list() with a line an account; `kind` is the id's own prefix (google: or a user name). */
export function leanAccounts(list) {
  return {
    googleSignIn: list.googleSignIn,
    accounts: list.accounts.map(({ id, name, role, state, lastActiveAt }) => ({ id, name, role, state, lastActiveAt })),
  };
}

/** alerts_get() with the latest alerts as one line each; their wording went to Telegram already. */
export function leanAlerts(base, recent = [], history = 5) {
  return { ...base, recent: recent.slice(0, history).map(({ at, event, status }) => ({ at, event, status })) };
}

/** settings_get() with the titledb's region files and the kept backups as counts; values and their locks stay whole. */
export function leanSettings(view) {
  const t = view.titledb ?? {};
  const b = view.backup ?? {};
  return {
    ...view,
    titledb: { titles: t.titles ?? 0, fetching: t.fetching === true, loadedAt: t.loadedAt ?? null, regions: (t.regions ?? []).length },
    backup: { days: b.days, last: b.last ? { day: b.last.day, files: b.last.files, bytes: b.last.bytes } : null, keptDays: (b.kept ?? []).length, dir: b.dir },
  };
}

/** library_storage_guide() with a line a folder (path, role, title); library_folder_guide gives one folder whole. */
export function leanStorageGuide(view) {
  const s = view.status;
  return {
    folders: view.guides.map(({ path, role, title }) => ({ path, role, title })),
    status: s ? { at: s.at, enabled: s.enabled, skipped: s.skipped ?? null, made: (s.made ?? []).length, failed: (s.failed ?? []).length } : null,
  };
}
