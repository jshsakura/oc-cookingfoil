/**
 * Authenticated, opt-in file upload → temp/ → apply flow.
 *
 * Concept (NsxLibraryManager-inspired): the games library is treated as
 * an authoritative, sanitized landing zone. Random uploads don't drop
 * straight into it. Instead:
 *
 *   1. POST /api/uploads
 *        multipart, single `file` field. Stored under
 *        `$COOK_DATA_DIR/uploads/<random-id>__<sanitized-filename>`.
 *        Server returns the upload id + parsed metadata if the filename
 *        carries a recognizable titleId.
 *
 *   2. GET /api/uploads
 *        Lists pending uploads (id, original name, size, parsed metadata,
 *        receivedAt). The dashboard renders these as an "Apply" tray.
 *
 *   3. POST /api/uploads/:id/apply
 *        Validates extension + final filename (no traversal, no overwrite
 *        of an existing game by default), then RENAMES from uploads/
 *        into the games library. chokidar picks up the new file and the
 *        shop cache rebuilds incrementally.
 *
 *   4. DELETE /api/uploads/:id
 *        Drop a pending upload without applying.
 *
 * Guarantees:
 *   - One-way flow: nothing in `uploads/` modifies the games library
 *     without an explicit Apply request.
 *   - Disabled by default. Flip COOK_UPLOADS_ENABLED=true to opt in.
 *   - Behind the normal auth-guard (so basic-auth required) AND the
 *     IP-lockout perimeter.
 *   - Filename sanitization rejects path separators, control chars, and
 *     anything that would shadow a dotfile.
 */
import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

import {
  romsDirPath,
  uploadsDir,
  uploadMaxBytes,
  uploadsEnabled,
} from "../helpers/envs.js";
import { parseFromFilename } from "../meta/filename-parser.js";
import debug from "../debug.js";

const GAME_EXT_RE = /\.(nsp|nsz|xci|xcz)$/i;
// Reject control chars, path separators, and dotfile-style names.
const UNSAFE_NAME_RE = /[\x00-\x1f\x7f/\\]/;

function safeBaseName(name) {
  if (typeof name !== "string") return null;
  const base = path.basename(name); // strip any client-supplied directories
  if (!base || base === "." || base === ".." || base.startsWith(".")) return null;
  if (UNSAFE_NAME_RE.test(base)) return null;
  if (!GAME_EXT_RE.test(base)) return null;
  return base;
}

function newUploadId() {
  return crypto.randomBytes(8).toString("hex");
}

function makeStorage() {
  return multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const sanitized = safeBaseName(file.originalname);
      if (!sanitized) {
        cb(new Error("invalid filename or unsupported extension"));
        return;
      }
      cb(null, `${newUploadId()}__${sanitized}`);
    },
  });
}

function parseStoredName(diskName) {
  // "<id>__<original>"
  const split = diskName.indexOf("__");
  if (split < 0) return null;
  const id = diskName.slice(0, split);
  const original = diskName.slice(split + 2);
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  if (!safeBaseName(original)) return null;
  return { id, original };
}

async function describeUpload(diskName) {
  const parsed = parseStoredName(diskName);
  if (!parsed) return null;
  const fullPath = path.join(uploadsDir, diskName);
  let stat;
  try { stat = await fs.stat(fullPath); } catch { return null; }
  if (!stat.isFile()) return null;
  const meta = parseFromFilename(parsed.original);
  return {
    id: parsed.id,
    name: parsed.original,
    size: stat.size,
    receivedAt: stat.mtime.toISOString(),
    titleId: meta.titleId ?? null,
    baseTitleId: meta.groupTitleId ?? null,
    kind: meta.contentType ?? null,
    diskName,
  };
}

async function listUploads() {
  let entries;
  try { entries = await fs.readdir(uploadsDir); } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const name of entries) {
    const desc = await describeUpload(name);
    if (desc) out.push(desc);
  }
  // Newest first.
  out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  return out;
}

async function findUploadById(id) {
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  let entries;
  try { entries = await fs.readdir(uploadsDir); } catch { return null; }
  const match = entries.find((n) => n.startsWith(`${id}__`));
  if (!match) return null;
  return describeUpload(match);
}

export default function uploadsRouter() {
  const router = express.Router();

  if (!uploadsEnabled) {
    // Disabled mode: every endpoint reports the opt-in env, so users find
    // it immediately on the network tab instead of seeing a 404 mystery.
    router.use((_req, res) => {
      res
        .status(503)
        .type("application/json")
        .send(JSON.stringify({ error: "uploads disabled — set COOK_UPLOADS_ENABLED=true" }));
    });
    return router;
  }

  const upload = multer({
    storage: makeStorage(),
    limits: { fileSize: uploadMaxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!safeBaseName(file.originalname)) {
        cb(new Error("invalid filename or unsupported extension"));
        return;
      }
      cb(null, true);
    },
  });

  router.get("/", async (_req, res) => {
    try {
      const list = await listUploads();
      res.json({ enabled: true, maxBytes: uploadMaxBytes, uploads: list });
    } catch (err) {
      debug.error("uploads list: %s", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // multer surfaces validation failures (bad filename, unsupported extension,
  // file too large) via the callback rather than throwing. Wrap it so the
  // user sees a clean 400 / 413 with the underlying reason instead of a
  // generic 500 from express's default error handler.
  router.post("/", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: err.message || "upload failed" });
    });
  }, async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "missing file field" });
      return;
    }
    const desc = await describeUpload(req.file.filename);
    if (!desc) {
      // Couldn't describe what we just wrote — clean up to avoid orphans.
      try { await fs.unlink(req.file.path); } catch {}
      res.status(500).json({ error: "post-write describe failed" });
      return;
    }
    debug.log("uploads: received %s (%d bytes)", desc.name, desc.size);
    res.status(201).json(desc);
  });

  router.post("/:id/apply", async (req, res) => {
    const desc = await findUploadById(req.params.id);
    if (!desc) {
      res.status(404).json({ error: "upload not found" });
      return;
    }
    const target = path.join(romsDirPath, desc.name);
    // Refuse to clobber an existing game unless the client passes ?force=1.
    // Force still requires the same auth + still respects the games root
    // (no path traversal possible — safeBaseName already enforced).
    const force = req.query.force === "1" || req.query.force === "true";
    try {
      await fs.access(target);
      if (!force) {
        res.status(409).json({ error: "target exists; pass ?force=1 to overwrite" });
        return;
      }
    } catch { /* doesn't exist — happy path */ }

    const source = path.join(uploadsDir, desc.diskName);
    try {
      // fs.rename is atomic on the same filesystem. Most setups have
      // dataDir and games on the same mount; if they aren't we fall back
      // to copy + unlink so cross-mount uploads still apply.
      await fs.rename(source, target);
    } catch (err) {
      if (err.code === "EXDEV") {
        try {
          await fs.copyFile(source, target);
          await fs.unlink(source);
        } catch (copyErr) {
          debug.error("uploads apply (cross-mount) failed: %s", copyErr.message);
          res.status(500).json({ error: copyErr.message });
          return;
        }
      } else {
        debug.error("uploads apply failed: %s", err.message);
        res.status(500).json({ error: err.message });
        return;
      }
    }
    debug.log("uploads: applied %s → games/", desc.name);
    res.json({ applied: true, name: desc.name, size: desc.size });
  });

  router.delete("/:id", async (req, res) => {
    const desc = await findUploadById(req.params.id);
    if (!desc) {
      res.status(404).json({ error: "upload not found" });
      return;
    }
    try {
      await fs.unlink(path.join(uploadsDir, desc.diskName));
    } catch (err) {
      debug.error("uploads delete failed: %s", err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
