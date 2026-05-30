/**
 * Authenticated, opt-in title-artwork upload router.
 *
 *   GET    /api/art/:baseTitleId               → which overrides exist
 *   POST   /api/art/:baseTitleId/icon          → upload/replace the icon
 *   POST   /api/art/:baseTitleId/banner        → upload/replace the banner
 *   POST   /api/art/:baseTitleId/screenshot    → append a screenshot
 *   DELETE /api/art/:baseTitleId/icon|banner   → remove it
 *   DELETE /api/art/:baseTitleId/screenshot/:idx
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
import debug from "../debug.js";

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

  router.get("/:baseTitleId", (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    res.json({ baseTitleId: base, ...customArt.list(base) });
  });

  async function handlePut(req, res, base, kind, idx) {
    if (!req.file || !req.file.buffer) {
      badRequest(res, "missing file field");
      return;
    }
    try {
      const r = await customArt.put(base, kind, idx, req.file.buffer);
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
    res.json({ deleted: true, baseTitleId: base, ...customArt.list(base) });
  });

  router.delete("/:baseTitleId/:kind", async (req, res) => {
    const base = requireBase(req, res);
    if (!base) return;
    const kind = req.params.kind;
    if (kind !== "icon" && kind !== "banner") {
      return badRequest(res, "kind must be icon or banner");
    }
    await customArt.remove(base, kind, null);
    res.json({ deleted: true, baseTitleId: base, ...customArt.list(base) });
  });

  return router;
}
