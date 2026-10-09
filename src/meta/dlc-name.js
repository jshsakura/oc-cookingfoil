// A DLC's display name. Its own titledb name wins; then the filename, unless the
// library renamer gave up and wrote "Unknown"; then the base game's name with
// the add-on number, so it still reads as that game's content.
const PLACEHOLDER_NAMES = new Set(["unknown", ""]);

export function dlcDisplayName({ ownName, fileName, baseName, titleId }) {
  if (ownName) return ownName;
  if (fileName && !PLACEHOLDER_NAMES.has(fileName.trim().toLowerCase())) return fileName;
  const number = titleId ? parseInt(titleId.slice(-3), 16) : null;
  const label = number ? `DLC ${number}` : "DLC";
  return baseName ? `${baseName} ${label}` : label;
}
