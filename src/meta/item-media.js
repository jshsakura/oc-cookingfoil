/**
 * Pictures for one kind of item (homebrew apps, patches), laid out as a game's:
 * an icon, a wide banner behind its header and a row of screenshots. Shared by
 * meta/homebrew-media.js and the patches, so every window is edited and shown alike.
 *
 * The pictures live in the item's own folder when it has one (`homeOf`), as
 * meta/art-sidecar.js names them, so the folder keeps them and a picture changed
 * there by hand is the one served; an item with no folder of its own keeps them in
 *   <dir>/<id>/icon.webp  banner.webp  screenshot-NN.webp
 * What is shown, and its version, is read from the disk. The record holds only
 * what the files cannot say:
 *   <file>   { <id>: { icon?, banner?, shots? } }
 * each part { source: "sgdb" | "igdb" | "upload", game?, at }, or { miss: at } (a
 * search that found nothing), or { off: true } (removed by the admin: never
 * filled in automatically again).
 *
 *   <dir>/<id>/<slot>.orig.webp/.orig.json   an upload kept for cutting again (meta/art-crop.js)
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import * as artCrop from "./art-crop.js";
import * as sidecar from "./art-sidecar.js";

export const MAX_SHOTS = sidecar.MAX_SHOTS;
const ICON = 512;
const BANNER_W = 1280;
const BANNER_H = 720;
const SHOT_W = 1280;
const SHOT_H = 720;
const sizeOf = (slot) => (slot === "icon" ? [ICON, ICON] : slot === "banner" ? [BANNER_W, BANNER_H] : [SHOT_W, SHOT_H]);

export class MediaImageError extends Error {}

async function encode(raw, [w, h]) {
  try {
    return await sidecar.toWebp(raw, w, h);
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
 * One store. `idRe` guards every id (they become folder names), `urlBase(id)` is
 * where the item's pictures are served ("/api/homebrew/<id>"). `homeOf(id)` is the
 * item's own folder, or null for one kept under `dir`; `ignoreOf(id)` names files in
 * that folder that look like pictures but belong to the item (a release's own icon.jpg).
 */
export function createMediaStore({ dir, file, idRe, urlBase, label = "media", homeOf = () => null, ignoreOf = () => null }) {
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

  const ownDir = (id) => path.join(dir, id);
  const homeDir = (id) => homeOf(id) ?? ownDir(id);
  const ignored = (id) => ignoreOf(id) ?? null;
  // Where an upload's kept original lives: always on the server, named after the slot.
  const anchor = (id, slot) => path.join(ownDir(id), `${slot}.webp`);

  /**
   * Pictures kept the old way under <dir>/<id> (shot-N.webp, with .jpg twins beside)
   * are named as sidecars, and moved into the item's folder when it has one; the
   * folder's own picture of a slot wins. Once per item and folder.
   */
  const settled = new Set();
  function settle(id) {
    const home = homeDir(id);
    const key = `${id}\0${home}`;
    if (settled.has(key)) return;
    const own = ownDir(id);
    let names;
    try {
      names = fs.readdirSync(own);
    } catch {
      settled.add(key);
      return;
    }
    try {
      for (const name of names) {
        const twin = /^(icon|banner|shot-\d+)\.jpg$/.exec(name);
        if (twin && names.includes(`${twin[1]}.webp`)) fs.rmSync(path.join(own, name), { force: true });
        const shot = /^shot-(\d+)\.webp$/.exec(name);
        if (shot) {
          const slot = sidecar.slotName("shot", Number(shot[1]));
          fs.renameSync(path.join(own, name), path.join(own, `${slot}.webp`));
          artCrop.moveOriginal(path.join(own, name), anchor(id, slot));
        }
      }
      if (home !== own) {
        const kept = sidecar.read(own);
        for (const p of [kept.icon, kept.banner, ...kept.shots].filter(Boolean)) {
          try {
            if (!sidecar.adopt(p.file, home, p.slot, { ignore: ignored(id) })) artCrop.removeOriginal(anchor(id, p.slot));
          } catch (err) {
            // Left here, and shown from here (pictures()); a name the item itself uses is not tried again.
            if (!(err instanceof sidecar.SlotTaken)) throw err;
          }
        }
      }
      settled.add(key);
    } catch (err) {
      debug.error("%s: %s: moving its pictures into %s: %s", label, id, home, err.message);
      settled.add(key);
    }
  }

  /** Writes a picture into the item's folder, or here when the item's own files use its name. Returns its version. */
  function writePicture(id, slot, webp) {
    try {
      return sidecar.versionOfFile(sidecar.write(homeDir(id), slot, webp, { ignore: ignored(id) }));
    } catch (err) {
      if (!(err instanceof sidecar.SlotTaken)) throw err;
      return sidecar.versionOfFile(sidecar.write(ownDir(id), slot, webp));
    }
  }

  // A picture put in by hand that is not .webp, or a slot holding two, is tidied once it is seen.
  const tidying = new Set();
  const failedTidy = new Map(); // id → the folder's pictures as they were when tidying them failed
  function tidy(id, signature) {
    if (tidying.has(id) || failedTidy.get(id) === signature) return;
    tidying.add(id);
    let failed = false;
    serial(id, () => sidecar.normalize(homeDir(id), sizeOf, {
      ignore: ignored(id),
      onError: (slot, err) => {
        failed = true;
        debug.error("%s: %s: %s left as it is: %s", label, id, slot, err.message);
      },
    })).catch((err) => {
      failed = true;
      debug.error("%s: %s: tidying its pictures: %s", label, id, err.message);
    }).finally(() => {
      tidying.delete(id);
      if (failed) failedTidy.set(id, signature);
      else failedTidy.delete(id);
    });
  }

  /** What the item's folder holds now: { icon, banner, shots } (meta/art-sidecar.js read). */
  function pictures(id) {
    if (!idRe.test(String(id))) return { icon: null, banner: null, shots: [] };
    settle(id);
    const got = sidecar.read(homeDir(id), { ignore: ignored(id) });
    if (got.untidy) tidy(id, got.signature);
    if (homeDir(id) === ownDir(id)) return got;
    // One that could not be moved into the folder (a read-only one) is still shown from here.
    const spare = sidecar.read(ownDir(id));
    return { icon: got.icon ?? spare.icon, banner: got.banner ?? spare.banner, shots: got.shots.length ? got.shots : spare.shots };
  }

  /** What is on file for one item: { icon?, banner?, shots? }. */
  const record = (id) => all()[id] ?? {};

  const iconPath = (id) => pictures(id).icon?.file ?? null;
  const bannerPath = (id) => pictures(id).banner?.file ?? null;
  const shotPath = (id, n) => pictures(id).shots[n - 1]?.file ?? null;
  const iconVersion = (id) => pictures(id).icon?.version ?? null;
  const bannerVersion = (id) => pictures(id).banner?.version ?? null;
  const shotsVersion = (id) => sidecar.shotsVersion(pictures(id).shots);
  const shotCount = (id) => pictures(id).shots.length;

  function shotUrls(id) {
    const { shots } = pictures(id);
    const v = sidecar.shotsVersion(shots);
    return shots.map((_, i) => `${urlBase(id)}/screenshot/${i + 1}?v=${v}`);
  }

  /** What a listing carries for an item: its own icon (or null), banner (or null) and screenshots. */
  function urls(id) {
    const p = pictures(id);
    const v = sidecar.shotsVersion(p.shots);
    return {
      custom_icon_url: p.icon ? `${urlBase(id)}/icon?v=${p.icon.version}` : null,
      banner_url: p.banner ? `${urlBase(id)}/banner?v=${p.banner.version}` : null,
      screenshots: p.shots.map((_, i) => `${urlBase(id)}/screenshot/${i + 1}?v=${v}`),
    };
  }

  // An upload keeps its original on the server (for cutting again); a picture found on its own does not.
  async function saveOne(id, part, raw, { source = "upload", game = null, now = Date.now(), crop = null } = {}) {
    check(id);
    settle(id);
    const webp = await encode(await cut(raw, crop), sizeOf(part));
    const original = source === "upload" ? await shrink(raw) : null;
    const version = writePicture(id, part, webp);
    if (original) artCrop.keepOriginal(anchor(id, part), original, crop, now, version);
    else artCrop.removeOriginal(anchor(id, part));
    put(id, part, { source, ...(game ? { game } : {}), at: now });
    return webp.length;
  }

  const saveIcon = (id, raw, opts) => saveOne(id, "icon", raw, opts);
  const saveBanner = (id, raw, opts) => saveOne(id, "banner", raw, opts);

  function removePart(id, part) {
    check(id);
    settle(id);
    sidecar.remove(homeDir(id), part, { ignore: ignored(id) });
    sidecar.remove(ownDir(id), part);
    artCrop.removeOriginal(anchor(id, part));
    put(id, part, { off: true });
  }
  /** Removes the icon (the item's own comes back); it is not filled in automatically again. */
  const removeIcon = (id) => removePart(id, "icon");
  /** Removes the banner; it is not filled in automatically again. */
  const removeBanner = (id) => removePart(id, "banner");

  function clearShots(id) {
    for (const s of pictures(id).shots) {
      sidecar.remove(homeDir(id), s.slot, { ignore: ignored(id) });
      sidecar.remove(ownDir(id), s.slot);
      artCrop.removeOriginal(anchor(id, s.slot));
    }
  }

  /**
   * Forgets the item: its record, the originals kept for it, and its pictures when
   * they are kept here. Pictures in the item's own folder stay with the folder.
   */
  function forget(id) {
    check(id);
    if (homeDir(id) === ownDir(id)) fs.rmSync(ownDir(id), { recursive: true, force: true });
    else for (const name of fs.existsSync(ownDir(id)) ? fs.readdirSync(ownDir(id)) : []) {
      if (/\.orig\.(webp|json)$/.test(name)) fs.rmSync(path.join(ownDir(id), name), { force: true });
    }
    const { [id]: _gone, ...rest } = all();
    persist(rest);
  }

  /**
   * Sets the item's screenshots to `raws`, in that order (replacing the ones it had).
   * Images that cannot be read are skipped; none readable throws.
   */
  async function saveShots(id, raws, { source = "upload", game = null, now = Date.now() } = {}) {
    check(id);
    settle(id);
    const encoded = [];
    for (const raw of raws.slice(0, MAX_SHOTS)) {
      try {
        encoded.push(await encode(raw, sizeOf("shot")));
      } catch (err) {
        if (raws.length === 1) throw err;
        debug.error("%s: %s: a screenshot left out: %s", label, id, err.message);
      }
    }
    if (!encoded.length) throw new MediaImageError("읽을 수 있는 이미지가 없습니다");
    clearShots(id);
    encoded.forEach((buf, i) => writePicture(id, sidecar.slotName("shot", i + 1), buf));
    put(id, "shots", { source, ...(game ? { game } : {}), at: now });
    return encoded.length;
  }

  /** Adds uploaded screenshots after the ones it has (up to MAX_SHOTS); those stay as they are, never encoded again. */
  async function addShots(id, raws, { now = Date.now(), crop = null } = {}) {
    check(id);
    settle(id);
    const have = pictures(id).shots;
    if (have.length + raws.length > MAX_SHOTS) throw new MediaImageError(`스크린샷은 ${MAX_SHOTS}장까지 둡니다`);
    const encoded = [];
    const originals = [];
    for (const raw of raws) {
      encoded.push(await encode(await cut(raw, crop), sizeOf("shot")));
      originals.push(await shrink(raw));
    }
    // After the highest number there, so a gap left by hand is never filled with a new one.
    let next = Math.max(0, ...have.map((s) => Number(s.slot.slice("screenshot-".length))));
    encoded.forEach((buf, i) => {
      const slot = sidecar.slotName("shot", ++next);
      artCrop.keepOriginal(anchor(id, slot), originals[i], crop, now, writePicture(id, slot, buf));
    });
    put(id, "shots", { source: "upload", at: now });
    return have.length + encoded.length;
  }

  /** Removes one screenshot (n from 1), or all of them with n = null; removing all stops automatic filling. */
  function removeShots(id, n = null) {
    check(id);
    settle(id);
    const shots = pictures(id).shots;
    if (n == null || shots.length <= 1) {
      clearShots(id);
      put(id, "shots", { off: true });
      return 0;
    }
    if (!Number.isInteger(n) || n < 1 || n > shots.length) throw new MediaImageError("없는 스크린샷입니다");
    const gone = shots[n - 1].slot;
    sidecar.remove(homeDir(id), gone, { ignore: ignored(id) });
    sidecar.remove(ownDir(id), gone);
    artCrop.removeOriginal(anchor(id, gone));
    // The ones left close up to screenshot-01 …, each original going with its picture.
    sidecar.renumberShots(homeDir(id), { ignore: ignored(id), onMove: (from, to) => artCrop.moveOriginal(anchor(id, from), anchor(id, to)) });
    return shots.length - 1;
  }

  // part "icon" | "banner" | "shot" (n from 1): the picture it names, or null when there is none.
  function pictureOf(id, part, n) {
    const p = pictures(id);
    return part === "icon" ? p.icon : part === "banner" ? p.banner : part === "shot" && Number.isInteger(n) ? p.shots[n - 1] ?? null : null;
  }

  /** The original kept for one picture: { image, crop }, or null; none once the picture was replaced by hand. */
  function original(id, part, n = null) {
    check(id);
    const pic = pictureOf(id, part, n);
    const kept = pic ? artCrop.readOriginal(anchor(id, pic.slot)) : null;
    return kept && (!kept.of || kept.of === pic.version) ? kept : null;
  }

  /** The area each kept original was cut to: { icon, banner, screenshots: [crop | null] }. */
  function originals(id) {
    return {
      icon: original(id, "icon")?.crop ?? null,
      banner: original(id, "banner")?.crop ?? null,
      screenshots: pictures(id).shots.map((_, i) => original(id, "shot", i + 1)?.crop ?? null),
    };
  }

  /** Cuts one picture again from its kept original; its version changes so nobody keeps the old one. */
  async function recrop(id, part, n, crop, { now = Date.now() } = {}) {
    check(id);
    const pic = pictureOf(id, part, n);
    const kept = original(id, part, n);
    if (!kept) throw new MediaImageError("다시 자를 원본이 없습니다");
    const webp = await encode(await cut(fs.readFileSync(kept.image), crop), sizeOf(part));
    artCrop.writeCrop(anchor(id, pic.slot), crop, now, writePicture(id, pic.slot, webp));
    return webp.length;
  }

  const one = (fn) => (id, ...args) => serial(String(id), () => fn(id, ...args));
  return {
    idRe, put, record, pictures, iconPath, bannerPath, shotPath, iconVersion, bannerVersion, shotsVersion, shotCount, shotUrls, urls,
    saveIcon: one(saveIcon), saveBanner: one(saveBanner), removeIcon: one(removeIcon), removeBanner: one(removeBanner),
    saveShots: one(saveShots), addShots: one(addShots), removeShots: one(removeShots),
    recrop: one(recrop), forget: one(forget), original, originals,
    /** Test seam. */
    resetForTests() { saved = null; settled.clear(); failedTidy.clear(); },
  };
}
