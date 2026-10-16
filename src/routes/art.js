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
 * Homebrew apps and patches, laid out alike (meta/item-media.js); `:kind` is homebrew or patch:
 *   GET    /api/art/:kind/:id                   → { icon, banner, screenshots } addresses (null / [] when none)
 *   POST   /api/art/:kind/:id/icon|banner        → upload/replace (form field "file")
 *   POST   /api/art/:kind/:id/screenshot         → add one (8 at most)
 *   DELETE /api/art/:kind/:id/icon|banner        → remove it (the app's own icon comes back)
 *   DELETE /api/art/:kind/:id/screenshot/:n      → remove one (n from 1); the rest close up
 *
 * Uploaded bytes are re-encoded by custom-art (sharp: resize cap + mozjpeg +
 * metadata strip), so a bad/huge image is rejected here rather than served.
 * The stored override wins over the titledb CDN proxy and NACP extraction in
 * the icon/banner/screenshot routes.
 *
 * Gating mirrors the game-upload tray: disabled unless COOK_UPLOADS_ENABLED,
 * and always behind the normal basic-auth + IP-lockout perimeter.
 */
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
import { defaultService as homebrewService } from "./homebrew.js";
import * as userPatches from "../meta/user-patches.js";

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
    return { icon: u.custom_icon_url, banner: u.banner_url, screenshots: u.screenshots };
  };
  const itemRoute = (fn) => async (req, res) => {
    try {
      const it = await item(req, res);
      if (it) await fn(req, res, it);
    } catch (err) {
      if (err instanceof MediaImageError) return badRequest(res, err.message);
      debug.error("art: %s/%s failed: %s", req.params.kind, req.params.id, err.message);
      res.status(500).json({ error: "could not save the picture" });
    }
  };
  router.get("/:kind(homebrew|patch)/:id", itemRoute(async (_req, res, { store, id }) => res.json(state(store, id))));
  router.post("/:kind(homebrew|patch)/:id/:slot(icon|banner|screenshot)", single, itemRoute(async (req, res, { store, id }) => {
    if (!req.file?.buffer) return badRequest(res, "missing file field");
    const slot = req.params.slot;
    if (slot === "icon") await store.saveIcon(id, req.file.buffer);
    else if (slot === "banner") await store.saveBanner(id, req.file.buffer);
    else await store.addShots(id, [req.file.buffer]);
    res.status(201).json(state(store, id));
  }));
  router.delete("/:kind(homebrew|patch)/:id/:slot(icon|banner)", itemRoute(async (req, res, { store, id }) => {
    if (req.params.slot === "icon") await store.removeIcon(id);
    else await store.removeBanner(id);
    res.json(state(store, id));
  }));
  router.delete("/:kind(homebrew|patch)/:id/screenshot/:n", itemRoute(async (req, res, { store, id }) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n)) return badRequest(res, "invalid screenshot");
    await store.removeShots(id, n);
    res.json(state(store, id));
  }));

  router.get("/:baseTitleId", (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    res.json({ baseTitleId: base, description: gameDescriptions.get(base)?.description ?? null, ...customArt.list(base) });
  });

  async function handlePut(req, res, base, kind, idx) {
    if (!req.file || !req.file.buffer) {
      badRequest(res, "missing file field");
      return;
    }
    try {
      const r = await customArt.put(base, kind, idx, req.file.buffer);
      invalidate();
      res.status(201).json({
        baseTitleId: base,
        kind,
        idx: kind === "screenshot" ? idx : undefined,
        bytes: r.bytes,
        ...customArt.list(base),
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
    res.json({ deleted: true, baseTitleId: base, ...customArt.list(base) });
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
    res.json({ deleted: true, baseTitleId: base, ...customArt.list(base) });
  });

  return router;
}
