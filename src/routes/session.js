/**
 * GET /api/session: a console that signed in with its password (or its
 * pairing's access key) trades it for a session token, and sends that instead
 * from then on (security/session-token.js, security/session-gate.js).
 *
 *   → 200 { token, expiresAt }       expiresAt in milliseconds; sign in again before or when it ends
 *   → 403 { error }                  signed in with a session already, or not a console
 *
 * A session never makes another: the password or access key must be shown
 * again, so a token taken off the network ends with its expiry.
 */
import { requester } from "../security/link-identity.js";
import * as session from "../security/session-token.js";

export default function sessionRoute(req, res) {
  res.set("Cache-Control", "no-store");
  if (req.sessionLane) return res.status(403).json({ error: "sign in with the password or access key to renew" });
  const who = requester(req);
  if (!session.eligible(who)) return res.status(403).json({ error: "sessions are for consoles that signed in" });
  res.json(session.issue(who));
}
