/**
 * Absolute-URL hardening for the shop response.
 *
 * Why this exists: CyberFoil/AeroFoil download per-item artwork by handing
 * `item.iconUrl` straight to curl (shopInstall.cpp::downloadImageWithAuth).
 * A host-relative "/api/shop/icon/<id>" has no host for curl to resolve, so
 * the icon silently fails on-device even though the browser dashboard — which
 * resolves the relative URL against its own origin — shows it fine. Emitting
 * ABSOLUTE artwork URLs keyed to the request's own origin fixes the on-device
 * case without breaking the browser one.
 *
 * Stock Tinfoil ignores per-item icon fields entirely (its index spec has no
 * icon field), so this only benefits the CyberFoil/AeroFoil family — which is
 * the intended target for server-served icons.
 */

// Proxy/Host headers are comma-joined lists when several hops are in play;
// the left-most value is the original client-facing one.
function firstHeaderValue(value) {
  if (!value) return "";
  return String(value).split(",")[0].trim();
}

/**
 * Resolve the absolute origin (scheme://host[:port]) to prefix onto the
 * shop response's artwork URLs.
 *
 * Precedence:
 *   1. publicBaseUrl       — operator-pinned (COOK_PUBLIC_BASE_URL), wins.
 *   2. X-Forwarded-Proto/Host — reverse-proxy hints.
 *   3. req.protocol + Host header — direct connection.
 *
 * Returns "" when no host can be determined; callers then fall back to the
 * host-relative URLs (still correct for same-origin browser fetches).
 */
export function resolveOrigin(req, publicBaseUrl) {
  if (publicBaseUrl) return publicBaseUrl;
  const host = firstHeaderValue(req.get("x-forwarded-host")) || req.get("host");
  if (!host) return "";
  const proto = firstHeaderValue(req.get("x-forwarded-proto")) || req.protocol || "http";
  return `${proto}://${host}`;
}

/**
 * Prefix every artwork proxy URL in a serialized shop response with `origin`.
 *
 * The match is anchored on the opening JSON-string quote so it only rewrites
 * our own proxy endpoints (`"/api/shop/...`): file-download URLs use the
 * "../" form, and externally-supplied custom-entry icon URLs are absolute
 * ("https://...") — neither starts with `"/api/shop/`, so both pass through
 * untouched. A falsy origin is a no-op (relative URLs preserved).
 */
export function rewriteArtworkOrigin(json, origin) {
  if (!origin) return json;
  return json.replaceAll('"/api/shop/', `"${origin}/api/shop/`);
}

/**
 * Make file-download URLs absolute, for the SAME reason as the artwork ones.
 *
 * Scanned-file entries carry a `"../" + percent-encoded-relpath` URL (the
 * legacy tinfoil-hat wire form). CyberFoil/AeroFoil hand the download URL
 * straight to curl just like they do icons — and a host-relative `../foo.nsp`
 * has no host to resolve against, so the download silently does nothing
 * on-device ("tap, no reaction") even though the browser dashboard, which
 * resolves `../` against its own origin, downloads fine. Anchor it at the
 * request origin:  "../foo.nsp"  →  "<origin>/foo.nsp".
 *
 * The match is anchored on `"../` (opening JSON-string quote + the relative
 * prefix) so it only touches values that START with `../` — i.e. our own
 * download URLs. Absolute custom-entry URLs ("https://…") never match. A
 * falsy origin is a no-op (browser same-origin resolves `../` correctly).
 */
export function rewriteDownloadOrigin(json, origin) {
  if (!origin) return json;
  return json.replaceAll('"../', `"${origin}/`);
}
