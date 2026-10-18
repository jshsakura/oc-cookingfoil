/**
 * Routes that change what everyone sees (artwork, descriptions, files in the
 * games folder) or list what was sent in, for admin accounts only.
 *
 * Signed in is not enough: a shop account with the user role, a per-device
 * login, a paired console and a console's session token read the shop but
 * never change it. `reads: true` holds GET and HEAD to the same rule (the
 * upload list); otherwise only writes are held.
 */
import { mayAdminister } from "./admin-actor.js";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether a request came in on a console's lane (pairing, device login or session), whoever is behind it. Pure. */
export const consoleLane = (req) => Boolean(req.pairedDevice || req.sessionLane);

export default function adminOnly({ reads = false } = {}) {
  return (req, res, next) => {
    if (!reads && READS.has(req.method)) return next();
    if (consoleLane(req) || !mayAdminister(req)) return res.status(403).json({ error: "admin accounts only" });
    next();
  };
}
