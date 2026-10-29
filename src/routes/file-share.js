/**
 * The public end of a file share link (library/file-shares.js), outside the sign-in like pairing: the token in the
 * link is the only key, and it opens one file until it runs out.
 *
 *   GET /share/<token>   the file as a download; 404 when the link is unknown, ended or its file is gone
 */
import express from "express";
import debug from "../debug.js";
import { createFileRoots, FileError } from "../library/file-roots.js";
import { fileShares } from "../library/file-shares.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export default function fileShareRouter({ shares = fileShares(), files = createFileRoots() } = {}) {
  const router = express.Router();
  router.get("/share/:token", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    const token = String(req.params.token);
    const share = TOKEN_RE.test(token) ? shares.find(token) : null;
    if (!share) return res.status(404).type("text/plain").send("This link has ended or does not exist.\n");
    let f;
    try {
      f = await files.open(share.root, share.rel);
    } catch (err) {
      if (!(err instanceof FileError) && err.code !== "ENOENT") throw err;
      return res.status(404).type("text/plain").send("The shared file is no longer there.\n");
    }
    debug.log("share: %s:%s sent by a link from %s", share.root, share.rel, share.by ?? "admin");
    res.download(f.abs, f.name, { dotfiles: "allow" });
  });
  return router;
}
