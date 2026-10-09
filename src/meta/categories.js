// Genre names from titledb. Kept short so the per-file section payload stays small.
const MAX_CATEGORIES = 4;
export function normalizeCategories(value, max = MAX_CATEGORIES) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 40);
  const unique = [...new Set(names)].slice(0, max);
  return unique.length ? unique : undefined;
}
