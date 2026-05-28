/**
 * Defensive response headers. Nothing fancy — just stop us from
 * volunteering information attackers like.
 */
export default function defensiveHeaders() {
  return (req, res, next) => {
    res.removeHeader("X-Powered-By");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-DNS-Prefetch-Control", "off");
    // Permissions-Policy: drop a few we'll never need from a shop server.
    res.set("Permissions-Policy", "interest-cohort=(), camera=(), geolocation=(), microphone=()");
    next();
  };
}
