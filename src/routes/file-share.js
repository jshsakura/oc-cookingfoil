/**
 * The public end of a file share link (library/file-shares.js), outside the sign-in like pairing: the token in the
 * link is the key, and it opens one file or folder until it runs out.
 *
 *   GET  /share/<token>             the file as a download, a folder as one zip, or for a link with a password the
 *                                   page that asks for it; 404 when the link is unknown, ended or its target is gone
 *   POST /share/<token> { password }  the same download once the password is right; 401 when it is not, 429 locked
 */
import express from "express";
import debug from "../debug.js";
import { createFileRoots, FileError } from "../library/file-roots.js";
import { fileShares } from "../library/file-shares.js";
import { sendZip } from "../library/zip-send.js";
import { requestLang } from "../meta/langs.js";
import { clientIp, recordFailure } from "../security/auth-guard.js";
import { matchesAsync } from "../security/password-hash.js";
import { lockNotice, lockoutRetryAfter, retryAfter } from "../security/retry-after.js";
import * as store from "../security/store.js";
import { plainPage } from "./not-found.js";
import { TOP_WORDS } from "./admin/top-i18n.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const PASSWORD_MAX = 200;

const form = express.urlencoded({ extended: false, limit: "1kb" });
const words = (lang) => TOP_WORDS[lang] ?? TOP_WORDS.en;
const asks = (lang, w, error = "") => plainPage(lang, w["sh.title"], `<p>${w["sh.lead"]}</p><form method="post">
${error ? `<p class="err" role="alert">${error}</p>` : ""}<label for="password">${w["sh.password"]}</label>
<input id="password" name="password" type="password" autocomplete="off" maxlength="200" required autofocus>
<button type="submit">${w["sh.go"]}</button></form>
<script>document.querySelector("form").addEventListener("submit",()=>document.querySelector(".err")?.remove())</script>`);

const gone = (req, res, key) => {
  const lang = requestLang(req);
  const w = words(lang);
  res.status(404).type("html").send(plainPage(lang, w["sh.link"], `<p>${w[key]}</p>`));
};

export default function fileShareRouter({ shares = fileShares(), files = createFileRoots() } = {}) {
  const router = express.Router();
  const found = (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Frame-Options": "DENY" });
    const token = String(req.params.token);
    const share = TOKEN_RE.test(token) ? shares.find(token) : null;
    if (!share) gone(req, res, "sh.ended");
    return share;
  };
  const send = async (req, res, share) => {
    let f, entries;
    try {
      if (share.dir) entries = await files.collect(share.root, [share.rel]);
      else f = await files.open(share.root, share.rel);
    } catch (err) {
      if (!(err instanceof FileError) && err.code !== "ENOENT") throw err;
      return gone(req, res, "sh.gone");
    }
    debug.log("share: %s:%s sent by a link from %s", share.root, share.rel, share.by ?? "admin");
    if (share.dir) return sendZip(res, entries, `${share.name}.zip`);
    res.download(f.abs, f.name, { dotfiles: "allow" });
  };

  router.get("/share/:token", async (req, res) => {
    const share = found(req, res);
    if (!share) return;
    if (!share.hash) return send(req, res, share);
    const lang = requestLang(req);
    res.type("html").send(asks(lang, words(lang)));
  });

  // A wrong password counts toward the same per-IP lockout as a sign-in. A right one does not clear it: a password
  // to one link is no reason to forgive guesses at an account.
  router.post("/share/:token", form, async (req, res) => {
    const share = found(req, res);
    if (!share) return;
    if (!share.hash) return send(req, res, share);
    const lang = requestLang(req);
    const w = words(lang);
    const ip = clientIp(req);
    if (store.isLocked(ip)) return retryAfter(res, lockoutRetryAfter(ip)).status(429).type("html").send(asks(lang, w, lockNotice(lang, ip)));
    if (await matchesAsync(share.hash, String(req.body?.password ?? "").slice(0, PASSWORD_MAX))) return send(req, res, share);
    recordFailure(ip, req);
    res.status(401).type("html").send(asks(lang, w, store.isLocked(ip) ? lockNotice(lang, ip) : w["sh.wrong"]));
  });
  return router;
}
