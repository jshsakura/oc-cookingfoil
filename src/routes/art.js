/**
 * Authenticated, opt-in title-artwork upload router.
 *
 *   GET    /api/art/:baseTitleId               → which overrides exist
 *   POST   /api/art/:baseTitleId/icon          → upload/replace the icon
 *   POST   /api/art/:baseTitleId/banner         → upload/replace the banner
 *   POST   /api/art/:baseTitleId/screenshot    → append a screenshot
 *   POST   /api/art/:baseTitleId/description   → the game's own text (admin's), { en, ko }
 *   DELETE /api/art/:baseTitleId/icon|banner   → remove it
 *   DELETE /api/art/:baseTitleId/screenshot/:idx
 *   DELETE /api/art/:baseTitleId/description   → back to titledb's own text
 *
 * Cutting a picture (meta/art-crop.js). An upload may carry a "crop" field,
 * JSON { x, y, w, h } as fractions 0..1 of the upright picture; only that area
 * becomes the art, and the upload is kept smaller beside it to cut again:
 *   GET    /api/art/:baseTitleId/icon|banner/original        → the kept original (WebP)
 *   GET    /api/art/:baseTitleId/screenshot/:idx/original
 *   POST   /api/art/:baseTitleId/icon|banner/crop            → { crop } cut again from it
 *   POST   /api/art/:baseTitleId/screenshot/:idx/crop
 *   GET /api/art/:baseTitleId carries originals: { icon, banner, screens: { <idx>: crop } }
 *   and urls: { icon, banner }, the shop addresses with their current ?v=
 * and the same for homebrew apps and patches (screenshots counted from 1):
 *   GET    /api/art/:kind/:id/icon|banner/original, /api/art/:kind/:id/screenshot/:n/original
 *   POST   /api/art/:kind/:id/icon|banner/crop,     /api/art/:kind/:id/screenshot/:n/crop
 *   whose state carries originals: { icon, banner, screenshots: [crop | null] }
 *
 * Homebrew apps and patches, laid out alike (meta/item-media.js); `:kind` is homebrew or patch:
 *   GET    /api/art/:kind/:id                   → { icon, banner, screenshots } addresses (null / [] when none)
 *   POST   /api/art/:kind/:id/icon|banner        → upload/replace (form field "file")
 *   POST   /api/art/:kind/:id/screenshot         → add one (8 at most)
 *   DELETE /api/art/:kind/:id/icon|banner        → remove it (the app's own icon comes back)
 *   DELETE /api/art/:kind/:id/screenshot/:n      → remove one (n from 1); the rest close up
 *
 * The facts the detail window's edit page changes, beside the pictures:
 *   GET|POST /api/art/:baseTitleId/meta    { name, description, notes } each { en, ko } (both empty forgets it)
 *   POST     /api/art/:baseTitleId/meta/reset   back to titledb's for all three
 *   GET|POST /api/art/homebrew/:id/meta    { description: { en, ko }, kind: "tool" | "port" }
 *   POST     /api/art/homebrew/:id/meta/reset   back to the repository's description
 *   GET|POST /api/art/patch/:id/meta       { name, nameKo, version, author, gameVersion, description, descriptionKo, required }
 *
 * Uploaded bytes are re-encoded by custom-art (sharp: resize cap + mozjpeg +
 * metadata strip), so a bad/huge image is rejected here rather than served.
 * The stored override wins over the titledb CDN proxy and NACP extraction in
 * the icon/banner/screenshot routes.
 *
 * Gating mirrors the game-upload tray: disabled unless COOK_UPLOADS_ENABLED,
 * and always behind the normal basic-auth + IP-lockout perimeter.
 */
import path from "node:path";
import express from "express";
import multer from "multer";

import { uploadsEnabled } from "../helpers/envs.js";
import * as customArt from "../meta/custom-art.js";
import * as gameDescriptions from "../meta/game-descriptions.js";
import debug from "../debug.js";
import { invalidate } from "../meta/shop-cache.js";
import * as homebrewMedia from "../meta/homebrew-media.js";
import patchMedia from "../meta/patch-media.js";
import { MediaImageError } from "../meta/item-media.js";
import { defaultService as homebrewService, rebuildHomebrewShortcut } from "./homebrew.js";
import * as userPatches from "../meta/user-patches.js";
import * as patchInfo from "../meta/patch-info.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as extractedMeta from "../meta/extracted-meta-store.js";
import * as homebrewKinds from "../meta/homebrew-kinds.js";
import * as homebrewDescriptions from "../meta/homebrew-descriptions.js";
import { patchMeta } from "./admin/content-api.js";
import { withRequired } from "./admin/patches-api.js";
import { parseCrop, CropError } from "../meta/art-crop.js";
import { versionedArtwork } from "../meta/artwork-version.js";

// Images are small relative to game files; 16 MiB is plenty for a 4K banner
// and keeps a single decode bounded.
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function badRequest(res, msg) {
  res.status(400).json({ error: msg });
}

export default function artRouter() {
  const router = express.Router();

  if (!uploadsEnabled) {
    router.use((_req, res) => {
      res
        .status(503)
        .type("application/json")
        .send(JSON.stringify({ error: "uploads disabled — set COOK_UPLOADS_ENABLED=true" }));
    });
    return router;
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      // Cheap gate; sharp is the authoritative validator in custom-art.put().
      if (!/^image\//i.test(file.mimetype)) {
        cb(new Error("only image uploads are accepted"));
        return;
      }
      cb(null, true);
    },
  });

  // Wrap multer so its validation/size errors come back as clean 4xx JSON.
  function single(req, res, next) {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: err.message || "upload failed" });
    });
  }

  function requireBase(req, res) {
    const base = customArt.normalizeBase(req.params.baseTitleId);
    if (!base) {
      badRequest(res, "invalid titleId");
      return null;
    }
    return base;
  }

  // Homebrew apps and patches: the item must be on its list, so nothing is written for an id that names nothing.
  const ITEMS = {
    homebrew: { store: homebrewMedia, exists: async (id) => (await homebrewService.list()).some((e) => e.id === id) },
    patch: { store: patchMedia, exists: async (id) => (await userPatches.list()).some((p) => p.id === id) },
  };
  const item = async (req, res) => {
    const kind = ITEMS[req.params.kind];
    const id = String(req.params.id ?? "");
    if (!kind || !kind.store.idRe.test(id)) return void badRequest(res, "invalid item");
    if (!(await kind.exists(id))) return void res.status(404).json({ error: "no such item" });
    return { store: kind.store, id };
  };
  const state = (store, id) => {
    const u = store.urls(id);
    return { icon: u.custom_icon_url, banner: u.banner_url, screenshots: u.screenshots, originals: store.originals(id) };
  };
  const itemRoute = (fn) => async (req, res) => {
    try {
      const it = await item(req, res);
      if (it) await fn(req, res, it);
    } catch (err) {
      if (err instanceof MediaImageError || err instanceof CropError) return badRequest(res, err.message);
      debug.error("art: %s/%s failed: %s", req.params.kind, req.params.id, err.message);
      res.status(500).json({ error: "could not save the picture" });
    }
  };
  // A homebrew app's HOME-menu shortcut carries its icon: built again in the background with the new one.
  const iconChanged = (req, id) => { if (req.params.kind === "homebrew") rebuildHomebrewShortcut(id); };
  router.get("/:kind(homebrew|patch)/:id", itemRoute(async (_req, res, { store, id }) => res.json(state(store, id))));

  // The facts beside the pictures. A JSON body, small: names and a few paragraphs.
  const metaJson = express.json({ limit: "32kb" });
  const both = (v) => (v && typeof v === "object" ? { en: typeof v.en === "string" ? v.en : null, ko: typeof v.ko === "string" ? v.ko : null } : null);
  const patchFacts = (id) => {
    const info = userPatches.infoOf(id) ?? {};
    return { name: info.name ?? "", nameKo: info.ko?.name ?? "", version: info.version ?? "", author: info.author ?? "",
      gameVersion: info.game_version ?? "", description: info.description ?? "", descriptionKo: info.ko?.description ?? "",
      required: info.required === true, homebrew: Boolean(userPatches.locate(id)?.dir.startsWith("homebrew/")) };
  };
  const homebrewFacts = (id) => ({ description: homebrewDescriptions.get(id) ?? null, kind: homebrewKinds.kindOf(id) });
  const metaRoute = (fn) => itemRoute(async (req, res, it) => {
    try {
      await fn(req, res, it);
    } catch (err) {
      if (err.status === 400 || err instanceof patchInfo.InfoError) return badRequest(res, err.message);
      throw err;
    }
  });
  router.get("/:kind(homebrew|patch)/:id/meta", metaRoute(async (req, res, { id }) =>
    res.json(req.params.kind === "patch" ? patchFacts(id) : homebrewFacts(id))));
  router.post("/:kind(homebrew|patch)/:id/meta", metaJson, metaRoute(async (req, res, { id }) => {
    const body = req.body ?? {};
    if (req.params.kind === "homebrew") {
      const d = both(body.description);
      if (d) homebrewDescriptions.set(id, d);
      if (body.kind !== undefined && !homebrewKinds.set(id, String(body.kind))) return badRequest(res, "kind is tool or port");
      debug.log("art: homebrew %s facts saved", id);
      return res.json(homebrewFacts(id));
    }
    const where = userPatches.locate(id);
    if (!where?.key) return void res.status(404).json({ error: "no such item" });
    let next = patchMeta(userPatches.infoOf(id), body);
    // A homebrew app's patch is never required: only a game waits on one.
    if (typeof body.required === "boolean" && !where.dir.startsWith("homebrew/")) next = withRequired(next, body.required);
    patchInfo.set(where.key, next);
    if (typeof body.required === "boolean") invalidate();
    debug.log("art: patch %s facts saved", where.key);
    res.json(patchFacts(id));
  }));
  router.post("/:kind(homebrew)/:id/meta/reset", metaRoute(async (_req, res, { id }) => {
    homebrewDescriptions.reset(id);
    res.json(homebrewFacts(id));
  }));

  const gameFacts = (base) => {
    const own = gameDescriptions.get(base) ?? {};
    return { name: own.name ?? null, description: own.description ?? null, notes: own.notes ?? null,
      original: { name: titledbStore.get(base)?.name ?? extractedMeta.get(base)?.name ?? null,
        description: titledbStore.get(base)?.description ?? extractedMeta.get(base)?.description ?? null } };
  };
  router.get("/:baseTitleId/meta", (req, res) => {
    const base = requireBase(req, res);
    if (base) res.json(gameFacts(base));
  });
  router.post("/:baseTitleId/meta", metaJson, (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    for (const field of gameDescriptions.FIELDS) {
      const v = both(req.body?.[field]);
      if (v) gameDescriptions.set(base, field, v);
    }
    // A changed name is baked into the list the server hands out: build it again.
    if (req.body?.name) invalidate({ rename: true });
    debug.log("art: facts of %s saved", base);
    res.json(gameFacts(base));
  });
  router.post("/:baseTitleId/meta/reset", (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    gameDescriptions.reset(base, null);
    invalidate({ rename: true });
    res.json(gameFacts(base));
  });
  router.post("/:kind(homebrew|patch)/:id/:slot(icon|banner|screenshot)", single, itemRoute(async (req, res, { store, id }) => {
    if (!req.file?.buffer) return badRequest(res, "missing file field");
    const slot = req.params.slot;
    const crop = parseCrop(req.body?.crop);
    if (slot === "icon") {
      await store.saveIcon(id, req.file.buffer, { crop });
      iconChanged(req, id);
    }
    else if (slot === "banner") await store.saveBanner(id, req.file.buffer, { crop });
    else await store.addShots(id, [req.file.buffer], { crop });
    res.status(201).json(state(store, id));
  }));
  // The kept original of one picture, and cutting it again. `n` counts screenshots from 1.
  const cropJson = express.json({ limit: "2kb" });
  const itemPart = (req) => (req.params.slot === "screenshot" ? ["shot", Number(req.params.n)] : [req.params.slot, null]);
  const sendOriginal = (res, kept) => {
    if (!kept) return void res.status(404).json({ error: "no original kept" });
    res.set("Cache-Control", "private, no-store").type("image/webp").sendFile(path.resolve(kept.image));
  };
  router.get(["/:kind(homebrew|patch)/:id/:slot(icon|banner)/original", "/:kind(homebrew|patch)/:id/:slot(screenshot)/:n(\\d+)/original"],
    itemRoute(async (req, res, { store, id }) => sendOriginal(res, store.original(id, ...itemPart(req)))));
  router.post(["/:kind(homebrew|patch)/:id/:slot(icon|banner)/crop", "/:kind(homebrew|patch)/:id/:slot(screenshot)/:n(\\d+)/crop"], cropJson,
    itemRoute(async (req, res, { store, id }) => {
      const crop = parseCrop(req.body?.crop);
      if (!crop) return badRequest(res, "missing crop");
      const [part, n] = itemPart(req);
      if (!store.original(id, part, n)) return void res.status(404).json({ error: "no original kept" });
      await store.recrop(id, part, n, crop);
      if (part === "icon") iconChanged(req, id);
      res.json(state(store, id));
    }));
  router.delete("/:kind(homebrew|patch)/:id/:slot(icon|banner)", itemRoute(async (req, res, { store, id }) => {
    if (req.params.slot === "icon") {
      await store.removeIcon(id);
      iconChanged(req, id);
    }
    else await store.removeBanner(id);
    res.json(state(store, id));
  }));
  router.delete("/:kind(homebrew|patch)/:id/screenshot/:n", itemRoute(async (req, res, { store, id }) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n)) return badRequest(res, "invalid screenshot");
    await store.removeShots(id, n);
    res.json(state(store, id));
  }));

  // What a game has: its slots, and the area each kept original was cut to.
  // urls: the shop addresses with their new ?v=, so the page shows a changed picture at once.
  const gameArt = (base) => ({ ...customArt.list(base), originals: customArt.originals(base),
    urls: { icon: versionedArtwork(`/api/shop/icon/${base}`), banner: versionedArtwork(`/api/shop/banner/${base}`) } });
  router.get("/:baseTitleId", (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    res.json({ baseTitleId: base, description: gameDescriptions.get(base)?.description ?? null, ...gameArt(base) });
  });

  // A game's slot from the address: [kind, idx], or null when it names none.
  const gameSlot = (req) => {
    if (req.params.kind !== "screenshot") return [req.params.kind, null];
    const idx = Number.parseInt(req.params.idx, 10);
    return Number.isInteger(idx) && idx >= 0 && idx < customArt.MAX_SCREENSHOTS ? ["screenshot", idx] : null;
  };
  router.get(["/:baseTitleId/:kind(icon|banner)/original", "/:baseTitleId/:kind(screenshot)/:idx(\\d+)/original"], (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const slot = gameSlot(req);
    if (!slot) return badRequest(res, "invalid screenshot index");
    sendOriginal(res, customArt.original(base, ...slot));
  });
  router.post(["/:baseTitleId/:kind(icon|banner)/crop", "/:baseTitleId/:kind(screenshot)/:idx(\\d+)/crop"], cropJson, async (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const slot = gameSlot(req);
    if (!slot) return badRequest(res, "invalid screenshot index");
    try {
      const crop = parseCrop(req.body?.crop);
      if (!crop) return badRequest(res, "missing crop");
      if (!customArt.original(base, ...slot)) return void res.status(404).json({ error: "no original kept" });
      const r = await customArt.recrop(base, ...slot, crop);
      invalidate();
      res.json({ baseTitleId: base, kind: slot[0], idx: slot[1] ?? undefined, bytes: r.bytes, ...gameArt(base) });
    } catch (err) {
      if (err instanceof CropError) return badRequest(res, err.message);
      debug.error("art: crop %s/%s failed: %s", base, slot[0], err.message);
      badRequest(res, "could not process image: " + err.message);
    }
  });

  async function handlePut(req, res, base, kind, idx) {
    if (!req.file || !req.file.buffer) {
      badRequest(res, "missing file field");
      return;
    }
    try {
      const r = await customArt.put(base, kind, idx, req.file.buffer, parseCrop(req.body?.crop));
      invalidate();
      res.status(201).json({
        baseTitleId: base,
        kind,
        idx: kind === "screenshot" ? idx : undefined,
        bytes: r.bytes,
        ...gameArt(base),
      });
    } catch (err) {
      // sharp throws on an unreadable/corrupt image — that's a client error.
      debug.error("art: put %s/%s failed: %s", base, kind, err.message);
      badRequest(res, "could not process image: " + err.message);
    }
  }

  router.post("/:baseTitleId/icon", single, (req, res) => {
    const base = requireBase(req, res);
    if (base) handlePut(req, res, base, "icon", null);
  });

  router.post("/:baseTitleId/banner", single, (req, res) => {
    const base = requireBase(req, res);
    if (base) handlePut(req, res, base, "banner", null);
  });

  router.post("/:baseTitleId/screenshot", single, (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const idx = customArt.nextScreenshotIdx(base);
    if (idx === null) {
      res.status(409).json({ error: `screenshot limit (${customArt.MAX_SCREENSHOTS}) reached` });
      return;
    }
    handlePut(req, res, base, "screenshot", idx);
  });

  router.delete("/:baseTitleId/screenshot/:idx", async (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const idx = Number.parseInt(req.params.idx, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= customArt.MAX_SCREENSHOTS) {
      return badRequest(res, "invalid screenshot index");
    }
    await customArt.remove(base, "screenshot", idx);
    invalidate();
    res.json({ deleted: true, baseTitleId: base, ...gameArt(base) });
  });

  // The admin's own text about the game. Before the generic /:kind DELETE
  // below, which would otherwise swallow "description".
  const descJson = express.json({ limit: "16kb" });
  router.post("/:baseTitleId/description", descJson, (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const text = (v) => (typeof v === "string" ? v : null);
    gameDescriptions.set(base, "description", { en: text(req.body?.en), ko: text(req.body?.ko) });
    res.status(201).json({ baseTitleId: base, description: gameDescriptions.get(base)?.description ?? null });
  });

  router.delete("/:baseTitleId/description", (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    gameDescriptions.reset(base, "description");
    res.json({ deleted: true, baseTitleId: base });
  });

  router.delete("/:baseTitleId/:kind", async (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const kind = req.params.kind;
    if (kind !== "icon" && kind !== "banner") {
      return badRequest(res, "kind must be icon or banner");
    }
    await customArt.remove(base, kind, null);
    invalidate();
    res.json({ deleted: true, baseTitleId: base, ...gameArt(base) });
  });

  return router;
}
