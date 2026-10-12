/**
 * Where a patch page says the files are. Only pixeldrain, GitHub releases and
 * Google Drive can be fetched without a person; gofile and dcinside are kept so
 * the report can point at them.
 */
const URL_RE = /https?:\/\/[^\s"'<>]+/g;

const RULES = [
  ["pixeldrain", /^https?:\/\/pixeldrain\.com\/u\/([A-Za-z0-9]+)/, (m) => ({ id: m[1], url: `https://pixeldrain.com/u/${m[1]}` })],
  ["github", /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/?#]|$)/, (m) => ({ repo: m[1], url: `https://github.com/${m[1]}` })],
  ["gdrive", /^https?:\/\/drive\.google\.com\/file\/d\/([\w-]+)/, (m) => ({ id: m[1], url: `https://drive.google.com/file/d/${m[1]}/view` })],
  ["gofile", /^https?:\/\/gofile\.io\/d\/(\w+)/, (m) => ({ id: m[1], url: m[0] })],
  ["dcinside", /^https?:\/\/(?:m\.|gall\.)?dcinside\.com\/[^\s]+/, (m) => ({ url: m[0] })],
  ["tistory", /^https?:\/\/[\w-]+\.tistory\.com\/(?:m\/)?\d+/, (m) => ({ url: m[0] })],
];

const unescape = (s) => s.replace(/&#x3D;/gi, "=").replace(/&amp;/g, "&");

/** Fetchable or reportable distribution links in a page, once each. Pure. */
export function sourcesIn(html) {
  const out = [];
  for (const raw of String(html ?? "").match(URL_RE) ?? []) {
    const url = unescape(raw);
    for (const [type, re, build] of RULES) {
      const m = url.match(re);
      if (!m) continue;
      const src = { type, ...build(m) };
      if (!out.some((o) => o.type === src.type && o.url === src.url)) out.push(src);
      break;
    }
  }
  return out;
}

// Builds for something other than a Switch running Atmosphère.
const NOT_SWITCH = /(xdelta|\.exe$|patcher|patchtool|tool|eden|emu|ryujinx|yuzu|windows|win64|macos|steam|ps1|ps2|psp|pc[_-])/i;

const gameVersion = (name) => (name.match(/for[_-]?(\d+(?:\.\d+)+)/i)?.[1] ?? "0").split(".").map(Number);
const newer = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

/**
 * The release asset to install, or null when the release has no Switch zip.
 * An asset named after the game wins; among versioned builds the newest game
 * version wins. Pure.
 */
export function pickGithubAsset(assets, tid) {
  const zips = assets.filter((a) => /\.zip$/i.test(a.name) && !NOT_SWITCH.test(a.name));
  if (tid) {
    const named = zips.find((a) => a.name.toUpperCase().includes(tid));
    if (named) return named;
  }
  if (!zips.length) return null;
  return zips.reduce((best, a) => (newer(gameVersion(a.name), gameVersion(best.name)) ? a : best));
}
