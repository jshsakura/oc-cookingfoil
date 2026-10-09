// Genre names from titledb. Kept short so the per-file section payload stays small.
const MAX_CATEGORIES = 4;
export function normalizeCategories(value) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 40);
  const unique = [...new Set(names)].slice(0, MAX_CATEGORIES);
  return unique.length ? unique : undefined;
}
