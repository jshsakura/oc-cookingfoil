/**
 * No games without the console keys. Until prod.keys is there (prod-keys.js
 * ready()), the shop list, the game files and everything a console or the web
 * library reads answer 503 with what to do. The admin page, its console API
 * (where an admin device hands the keys in), sign-in, setup and pairing stay
 * open, so the keys can be put in without a restart.
 */
import { ready } from "./prod-keys.js";

const BLOCKED = ["/shop.json", "/api/shop", "/api/title", "/api/patches", "/api/homebrew", "/api/retro", "/api/saves", "/api/art", "/api/uploads", "/api/inbox", "/api/votes"];
const GAME_FILE_RE = /\.(nsp|nsz|xci|xcz)$/i;

export const MESSAGE = "서버에 prod.keys 가 없어 아직 게임을 내주지 않습니다. 관리자가 관리 페이지의 설정 탭에서 prod.keys 를 넣으면 바로 열립니다.";

const blocked = (p) => GAME_FILE_RE.test(p) || BLOCKED.some((b) => p === b || p.startsWith(`${b}/`));

export function keysGate({ isReady = ready } = {}) {
  return (req, res, next) => {
    let p = req.path;
    try {
      p = decodeURIComponent(p);
    } catch {
      // a malformed path is judged as it came
    }
    if (!blocked(p) || isReady()) return next();
    res.status(503).set("Cache-Control", "no-store").set("Retry-After", "60");
    if ((req.headers.accept || "").includes("text/html")) {
      return res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CookingFoil</title><p style="font:16px/1.6 system-ui;max-width:36em;margin:3em auto;padding:0 16px">${MESSAGE} <a href="/admin">관리 페이지</a></p>`);
    }
    res.json({ error: MESSAGE, code: "no-prod-keys" });
  };
}
