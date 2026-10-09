export function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, "https://shop.example.com/");
    return ["http:", "https:"].includes(url.protocol) ? value : "";
  } catch { return ""; }
}
export function versionLabel(item) {
  const label = item?.version_name || item?.display_version;
  if (typeof label === "string" && label) return label.startsWith("v") ? label : "v" + label;
  return "v" + (Number.isFinite(item?.app_version) ? item.app_version : 0);
}
const smaller = (a, b) => (a.size > 0 ? a.size : Infinity) - (b.size > 0 ? b.size : Infinity)
  || a.url.localeCompare(b.url);
const newest = (a, b) => (b.app_version || 0) - (a.app_version || 0) || smaller(a, b);
export function groupCatalog(items) {
  const buckets = new Map();
  for (const raw of items) {
    if (!raw || !safeUrl(raw.url)) continue;
    const item = { ...raw, icon_url: safeUrl(raw.icon_url), app_type: raw.app_type || "base" };
    const key = item.base_title_id || item.title_id || item.url;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  return [...buckets.entries()].map(([id, files]) => {
    const bases = files.filter((f) => f.app_type === "base").sort(smaller);
    const updates = files.filter((f) => f.app_type === "update").sort(newest);
    const dlcMap = new Map();
    for (const file of files.filter((f) => f.app_type === "dlc").sort(newest)) {
      const key = file.title_id || file.url;
      if (!dlcMap.has(key)) dlcMap.set(key, file);
    }
    const representative = bases[0] || files[0];
    const languages = Array.isArray(representative.languages) ? representative.languages : [];
    const categories = Array.isArray(representative.categories) ? representative.categories : [];
    return {
      id, name: representative.name || "CookingFoil", publisher: representative.publisher || "",
      icon: representative.icon_url || "", languages, categories,
      base: bases[0] || null, update: updates[0] || null, dlc: [...dlcMap.values()],
      alternatives: bases.slice(1), files,
      addedAt: Math.max(0, ...bases.map((f) => Number.isFinite(f.added_at) ? f.added_at : 0)),
      releaseDate: representative.release_date || 0,
      search: files.map((f) => [f.name, f.title_id, f.publisher].join(" ")).join(" ").toLocaleLowerCase(),
    };
  });
}
export function selectCatalog(groups, { query = "", filter = "all", sort = "name" } = {}) {
  return groups.filter((g) => (!query || g.search.includes(query.toLocaleLowerCase()))
    && (filter !== "ko" || g.languages.includes("ko"))
    && (!filter.startsWith("genre:") || g.categories.includes(filter.slice(6)))
    && (filter !== "update" || g.update)
    && (filter !== "dlc" || g.dlc.length)
    && (filter !== "custom" || !/^[0-9A-F]{16}$/i.test(g.id)))
    .sort((a, b) => {
      if (sort === "recent") return b.addedAt - a.addedAt || a.name.localeCompare(b.name);
      if (sort === "release") return b.releaseDate - a.releaseDate || a.name.localeCompare(b.name);
      if (sort === "size") return (b.base?.size || 0) - (a.base?.size || 0);
      return a.name.localeCompare(b.name);
    });
}
export function bytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; ++i; }
  return n.toFixed(i > 1 && n < 10 ? 1 : 0) + " " + units[i];
}
// Home shelves: the most common genres among base games, each game shown once.
export function genreShelves(groups, { exclude = new Set(), count = 4, size = 24, minimum = 6 } = {}) {
  const tally = new Map();
  for (const g of groups) if (g.base) for (const name of g.categories) tally.set(name, (tally.get(name) || 0) + 1);
  const seen = new Set(exclude), shelves = [];
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  for (const name of ranked) {
    if (shelves.length >= count) break;
    const games = selectCatalog(groups, { filter: "genre:" + name, sort: "release" })
      .filter((g) => g.base && !seen.has(g.id)).slice(0, size);
    if (games.length < minimum) continue;
    games.forEach((g) => seen.add(g.id));
    shelves.push({ name, games });
  }
  return shelves;
}
