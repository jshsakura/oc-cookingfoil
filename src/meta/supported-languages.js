// Supported game languages come from explicit metadata, never from the
// region file's language or a localized display name.
export function normalizeSupportedLanguages(value) {
  if (!Array.isArray(value)) return undefined;
  const codes = value
    .filter((code) => typeof code === "string")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code));
  const unique = [...new Set(codes)];
  return unique.length ? unique : undefined;
}
