/**
 * Percent-encodes a library-relative path for use in a file address.
 *
 * encodeURIComponent already covers the reserved characters (`?`, `#`, `%`,
 * `/` and the rest), and `/` becoming `%2F` is the wire format clients expect.
 * It leaves `(` and `)` alone, so those two are encoded by hand. `!` `*` `'`
 * and `~` stay as they are.
 */
export function encodePathSegment(value) {
  if (!value) return value;
  return encodeURIComponent(value).replace(
    /[()]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Replaces the `url` field of an entry with its encoded form. */
export function withEncodedUrl(entry) {
  entry.url = encodePathSegment(entry.url);
  return entry;
}
