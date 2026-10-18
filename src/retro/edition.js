/**
 * What a ROM's tags say about its edition, as flags the client can badge
 * instead of printing the raw tags ("[J-K v20221128 v1.1]") in the list.
 *
 *   korean   true when the game is in Korean
 *   source   "official" released in Korean (unlicensed Korean carts too),
 *            "patch" a Korean fan translation
 *   from     the region a translation was made from: "jp", "us", "world", "eu"
 *   version  the patch version, "v1.1"
 *
 * Only what a tag says plainly is reported; anything else stays in `variant`.
 * File names on the SD card do not change.
 */
const FROM = { J: "jp", U: "us", W: "world", E: "eu" };

/** Flags for a game's joined tags ("J-K v20221128 v1.1", "Korea", "Korean Translation 911202"), or null. Pure. */
export function editionOf(tags) {
  const s = String(tags ?? "").trim();
  if (!s) return null;
  const pair = s.match(/(?:^|[\s,])(J|U|W|E|Unl)-K\b|\bUnl-K\b/);
  const patched = Boolean(pair) || /(?:^|\s)K(?:\s|$)|한글|\bko(?:-|\b)|\bKorean Translation\b|\bHangul\b/i.test(s);
  const released = /\bKorea\b|\bKorean release\b/i.test(s);
  if (!patched && !released) return null;
  const version = [...s.matchAll(/\bv\d[\w.-]*/g)].map((m) => m[0]).pop() ?? null;
  const from = pair && FROM[pair[1]];
  return {
    korean: true,
    source: released && !patched ? "official" : "patch",
    ...(from ? { from } : {}),
    ...(version ? { version } : {}),
  };
}
