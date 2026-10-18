/** HTML-escape a value before it goes into one of the admin page templates. */
const REPLACEMENTS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => REPLACEMENTS[c]);
}
