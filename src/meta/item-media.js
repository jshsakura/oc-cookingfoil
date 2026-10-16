/**
 * Pictures for one kind of item (homebrew apps, patches), laid out as a game's:
 * an icon, a wide banner behind its header and a row of screenshots. Shared by
 * meta/homebrew-media.js and the patches, so every window is edited and shown alike.
 *
 *   <dir>/<id>/icon.webp       at most ICON × ICON
 *   <dir>/<id>/banner.webp     at most BANNER_W × BANNER_H
 *   <dir>/<id>/shot-<n>.webp   n = 1 … MAX_SHOTS, at most SHOT_W × SHOT_H
 *   <dir>/<id>/<part>.orig.webp an upload kept for cutting again, with <part>.orig.json (meta/art-crop.js)
 *   <file>                     { <id>: { icon?, banner?, shots? } }
 *
 * Each part: { source: "sgdb" | "igdb" | "upload", game?, count?, at }, or
 * { miss: at } (a search that found nothing), or { off: true } (removed by the
 * admin: never filled in automatically again). Every WebP gets a JPEG twin on
 * demand (jpegOf) for clients that cannot read WebP.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import debug from "../debug.js";
import * as artCrop from "./art-crop.js";

export const MAX_SHOTS = 8;
const ICON = 512;
const BANNER_W = 1280;
const BANNER_H = 720;
const SHOT_W = 1280;
const SHOT_H = 720;

export class MediaImageError extends Error {}

const twin = (webp) => webp.replace(/\.webp$/, ".jpg");

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, buf);
  fs.renameSync(`${file}.tmp`, file);
}

const rmBoth = (file) => {
  fs.rmSync(file, { force: true });
  fs.rmSync(twin(file), { force: true });
};

async function encode(raw, w, h) {
  try {
    return await sharp(raw, { failOn: "none", limitInputPixels: 50e6 })
      .rotate()
      .resize({ width: w, height: h, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 })
      .toBuffer();
  } catch (err) {
    throw new MediaImageError(`이미지를 읽지 못했습니다: ${err.message}`);
  }
}

// The chosen area of an upload, as a MediaImageError when it does not fit the picture.
async function cut(raw, crop) {
  try {
    return await artCrop.cropOf(raw, crop, { failOn: "none" });
  } catch (err) {
    if (err instanceof artCrop.CropError) throw new MediaImageError(err.message);
    throw err;
  }
}
const shrink = async (raw) => {
  try {
    return await artCrop.shrinkOriginal(raw, { failOn: "none" });
  } catch (err) {
    throw new MediaImageError(err.message);
  }
};

/**
 * The JPEG twin of a stored WebP, for clients that cannot read WebP (older consoles,
 * CyberFoil): made the first time one asks, then kept beside it until the WebP changes.
 */
export async function jpegOf(webpFile) {
  const jpg = twin(webpFile);
  const src = fs.statSync(webpFile);
  try {
    if (fs.statSync(jpg).mtimeMs >= src.mtimeMs) return jpg;
  } catch { /* not made yet */ }
  writeAtomic(jpg, await sharp(webpFile).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
  return jpg;
}

/**
 * One store. `idRe` guards every id (they become folder names), `urlBase(id)` is
 * where the item's pictures are served ("/api/homebrew/<id>").
 */
export function createMediaStore({ dir, file, idRe, urlBase, label = "media" }) {
  let saved = null;
  function all() {
    if (saved) return saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code && err.code !== "ENOENT") throw err;
      // A file that no longer parses is kept aside, not left to break every listing.
      if (!err.code) {
        debug.error("%s: %s does not parse (%s); kept as .corrupt, starting empty", label, file, err.message);
        try { fs.renameSync(file, `${file}.corrupt`); } catch { /* gone already */ }
      }
      saved = {};
    }
    return saved;
  }

  function persist(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    saved = next;
  }

  /** Sets one part ("icon" | "banner" | "shots") of an item's record. */
  function put(id, part, value) {
    const cur = all();
    persist({ ...cur, [id]: { ...cur[id], [part]: value } });
  }

  // Writes to one item run one at a time: two uploads at once would both pick the same next screenshot number.
  const queues = new Map();
  function serial(id, fn) {
    const run = (queues.get(id) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
    return run;
  }

  const check = (id) => {
    if (!idRe.test(String(id))) throw new MediaImageError("번호가 맞지 않습니다");
  };

  const dirOf = (id) => path.join(dir, id);
  const iconPath = (id) => path.join(dirOf(id), "icon.webp");
  const bannerPath = (id) => path.join(dirOf(id), "banner.webp");
  const shotPath = (id, n) => path.join(dirOf(id), `shot-${n}.webp`);

  /** What is on file for one item: { icon?, banner?, shots? }. */
  const record = (id) => all()[id] ?? {};

  const stamp = (part) => (part?.source && part.at ? part.at.toString(36) : null);
  const iconVersion = (id) => stamp(record(id).icon);
  const bannerVersion = (id) => stamp(record(id).banner);
  const shotsVersion = (id) => stamp(record(id).shots);

  function shotUrls(id) {
    const s = record(id).shots;
    const v = stamp(s);
    return v ? Array.from({ length: s.count }, (_, i) => `${urlBase(id)}/screenshot/${i + 1}?v=${v}`) : [];
  }

  /** What a listing carries for an item: its own icon (or null), banner (or null) and screenshots. */
  function urls(id) {
    const iv = iconVersion(id);
    const bv = bannerVersion(id);
    return { custom_icon_url: iv ? `${urlBase(id)}/icon?v=${iv}` : null, banner_url: bv ? `${urlBase(id)}/banner?v=${bv}` : null, screenshots: shotUrls(id) };
  }

  // An upload keeps its original beside the art (for cutting again); a picture found on its own does not.
  async function saveOne(id, part, filePath, raw, w, h, { source = "upload", game = null, now = Date.now(), crop = null } = {}) {
    check(id);
    const webp = await encode(await cut(raw, crop), w, h);
    const original = source === "upload" ? await shrink(raw) : null;
    writeAtomic(filePath, webp);
    if (original) artCrop.keepOriginal(filePath, original, crop, now);
    else artCrop.removeOriginal(filePath);
    put(id, part, { source, ...(game ? { game } : {}), at: now });
    return webp.length;
  }

  const saveIcon = (id, raw, opts) => saveOne(id, "icon", iconPath(id), raw, ICON, ICON, opts);
  const saveBanner = (id, raw, opts) => saveOne(id, "banner", bannerPath(id), raw, BANNER_W, BANNER_H, opts);

  /** Removes the icon (the item's own comes back) or the banner; neither is filled in automatically again. */
  function removeIcon(id) {
    check(id);
    rmBoth(iconPath(id));
    artCrop.removeOriginal(iconPath(id));
    put(id, "icon", { off: true });
  }
  function removeBanner(id) {
    check(id);
    rmBoth(bannerPath(id));
    artCrop.removeOriginal(bannerPath(id));
    put(id, "banner", { off: true });
  }

  /**
   * Sets the item's screenshots to `raws`, in that order (replacing the ones it had).
   * Images that cannot be read are skipped; none readable throws.
   */
  async function saveShots(id, raws, { source = "upload", game = null, now = Date.now() } = {}) {
    check(id);
    const encoded = [];
    for (const raw of raws.slice(0, MAX_SHOTS)) {
      try {
        encoded.push(await encode(raw, SHOT_W, SHOT_H));
      } catch (err) {
        if (raws.length === 1) throw err;
        debug.error("%s: %s: a screenshot left out: %s", label, id, err.message);
      }
    }
    if (!encoded.length) throw new MediaImageError("읽을 수 있는 이미지가 없습니다");
    encoded.forEach((buf, i) => writeAtomic(shotPath(id, i + 1), buf));
    for (let n = 1; n <= MAX_SHOTS; n++) artCrop.removeOriginal(shotPath(id, n));
    for (let n = encoded.length + 1; n <= MAX_SHOTS; n++) rmBoth(shotPath(id, n));
    put(id, "shots", { source, count: encoded.length, ...(game ? { game } : {}), at: now });
    return encoded.length;
  }

  /** Adds uploaded screenshots after the ones it has (up to MAX_SHOTS); those stay as they are, never encoded again. */
  async function addShots(id, raws, { now = Date.now(), crop = null } = {}) {
    check(id);
    const have = record(id).shots?.count ?? 0;
    if (have + raws.length > MAX_SHOTS) throw new MediaImageError(`스크린샷은 ${MAX_SHOTS}장까지 둡니다`);
    const encoded = [];
    const originals = [];
    for (const raw of raws) {
      encoded.push(await encode(await cut(raw, crop), SHOT_W, SHOT_H));
      originals.push(await shrink(raw));
    }
    encoded.forEach((buf, i) => {
      writeAtomic(shotPath(id, have + i + 1), buf);
      artCrop.keepOriginal(shotPath(id, have + i + 1), originals[i], crop, now);
    });
    put(id, "shots", { source: "upload", count: have + encoded.length, at: now });
    return have + encoded.length;
  }

  /** Removes one screenshot (n from 1), or all of them with n = null; removing all stops automatic filling. */
  function removeShots(id, n = null) {
    check(id);
    const s = record(id).shots;
    if (n == null || !s?.count || s.count <= 1) {
      for (let i = 1; i <= MAX_SHOTS; i++) { rmBoth(shotPath(id, i)); artCrop.removeOriginal(shotPath(id, i)); }
      put(id, "shots", { off: true });
      return 0;
    }
    if (!Number.isInteger(n) || n < 1 || n > s.count) throw new MediaImageError("없는 스크린샷입니다");
    // The ones left, in order, from what is actually on disk: a missing file never leaves the set out of step.
    const keep = [];
    for (let i = 1; i <= s.count; i++) if (i !== n && fs.existsSync(shotPath(id, i))) keep.push({ from: i, buf: fs.readFileSync(shotPath(id, i)) });
    artCrop.removeOriginal(shotPath(id, n));
    keep.forEach(({ from, buf }, i) => {
      writeAtomic(shotPath(id, i + 1), buf);
      if (from !== i + 1) artCrop.moveOriginal(shotPath(id, from), shotPath(id, i + 1));
    });
    for (let i = keep.length + 1; i <= MAX_SHOTS; i++) { rmBoth(shotPath(id, i)); artCrop.removeOriginal(shotPath(id, i)); }
    put(id, "shots", keep.length ? { ...s, count: keep.length, at: Date.now() } : { off: true });
    return keep.length;
  }

  // part "icon" | "banner" | "shot" (n from 1): the art file it names, or null when there is none.
  function artFile(id, part, n) {
    if (part === "icon") return record(id).icon?.source ? iconPath(id) : null;
    if (part === "banner") return record(id).banner?.source ? bannerPath(id) : null;
    const s = record(id).shots;
    return part === "shot" && Number.isInteger(n) && s?.source && n >= 1 && n <= s.count ? shotPath(id, n) : null;
  }

  /** The original kept for one picture: { image, crop }, or null. */
  function original(id, part, n = null) {
    check(id);
    const f = artFile(id, part, n);
    return f ? artCrop.readOriginal(f) : null;
  }

  /** The area each kept original was cut to: { icon, banner, screenshots: [crop | null] }. */
  function originals(id) {
    const count = record(id).shots?.source ? record(id).shots.count : 0;
    return {
      icon: original(id, "icon")?.crop ?? null,
      banner: original(id, "banner")?.crop ?? null,
      screenshots: Array.from({ length: count }, (_, i) => original(id, "shot", i + 1)?.crop ?? null),
    };
  }

  /** Cuts one picture again from its kept original; the address changes so nobody keeps the old one. */
  async function recrop(id, part, n, crop, { now = Date.now() } = {}) {
    check(id);
    const f = artFile(id, part, n);
    const kept = f ? artCrop.readOriginal(f) : null;
    if (!kept) throw new MediaImageError("다시 자를 원본이 없습니다");
    const [w, h] = part === "icon" ? [ICON, ICON] : part === "banner" ? [BANNER_W, BANNER_H] : [SHOT_W, SHOT_H];
    const webp = await encode(await cut(fs.readFileSync(kept.image), crop), w, h);
    writeAtomic(f, webp);
    fs.rmSync(twin(f), { force: true });
    artCrop.writeCrop(f, crop, now);
    const key = part === "shot" ? "shots" : part;
    put(id, key, { ...record(id)[key], at: Math.max(now, (record(id)[key]?.at ?? 0) + 1) });
    return webp.length;
  }

  const one = (fn) => (id, ...args) => serial(String(id), () => fn(id, ...args));
  return {
    idRe, put, record, iconPath, bannerPath, shotPath, iconVersion, bannerVersion, shotsVersion, shotUrls, urls,
    saveIcon: one(saveIcon), saveBanner: one(saveBanner), removeIcon: one(removeIcon), removeBanner: one(removeBanner),
    saveShots: one(saveShots), addShots: one(addShots), removeShots: one(removeShots),
    recrop: one(recrop), original, originals,
    /** Test seam. */
    resetForTests() { saved = null; },
  };
}
