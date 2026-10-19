// The phone page's script (/ra-link/app.js): seals { u, p } to the console's key from the QR
// (retro/achievements/link.js has the envelope) and follows the console's sign-in.
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

const T = JSON.parse(document.getElementById("ra-text").textContent);
const $ = (id) => document.getElementById(id);
const NAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));

const code = new URLSearchParams(location.search).get("c") || "";
const devicePk = (() => {
  try {
    const k = fromB64u(new URLSearchParams(location.hash.slice(1)).get("k") || "");
    p256.Point.fromBytes(k);
    return k.length === 65 && k[0] === 4 ? k : null;
  } catch { return null; }
})();
const api = `/ra-link/api/${encodeURIComponent(code)}`;

function say(text, kind = "") { const m = $("msg"); m.textContent = text; m.className = kind; }
function end(text, kind) { $("form").hidden = true; say(text, kind); }

/** The envelope for `plain` under the code, to the console's key. */
function seal(plain) {
  const eph = p256.utils.randomSecretKey();
  const x = p256.getSharedSecret(eph, devicePk).slice(1, 33);
  const key = hkdf(sha256, x, undefined, enc.encode("cookingfoil-ra-link"), 32);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, iv, enc.encode(code)).encrypt(enc.encode(JSON.stringify(plain)));
  return { epk: b64u(p256.getPublicKey(eph, false)), iv: b64u(iv), ct: b64u(ct) };
}

// Follows the link until the console is done with this envelope; each request waits on the server.
async function follow(after) {
  for (;;) {
    let r;
    try { r = await fetch(`${api}?after=${after}`, { cache: "no-store" }); }
    catch { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    if (r.status === 410) return end(T.expired, "bad");
    if (!r.ok) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const v = await r.json();
    after = v.state;
    if (v.state === "done") return end(T.done, "ok");
    if (v.state === "failed") return end(T.failed, "bad");
    if (v.state === "wrong" || v.state === "unreadable") {
      $("send").disabled = false; $("password").value = ""; $("password").focus();
      return say(v.state === "wrong" ? T.wrongText.replace("{n}", v.triesLeft) : T.unreadable, "bad");
    }
  }
}

async function send(e) {
  e.preventDefault();
  const u = $("username").value.trim(), p = $("password").value;
  if (!NAME_RE.test(u)) return say(T.invalidName, "bad");
  if (!p) return say(T.emptyPassword, "bad");
  $("send").disabled = true;
  say(T.sending);
  // Let the words paint before the key work runs.
  await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok)));
  try {
    const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seal({ u, p })) });
    $("password").value = "";
    if (r.status === 410) return end(T.expired, "bad");
    if (!r.ok) { $("send").disabled = false; return say(T.network, "bad"); }
    say(T.waiting);
    follow("sealed");
  } catch {
    $("send").disabled = false;
    say(T.network, "bad");
  }
}

// Which account and console asked, so a link someone else sent reads as theirs.
function showAsker(r) {
  const account = r?.account, device = r?.device;
  const text = account && device ? T.askBoth : account ? T.askAccount : device ? T.askDevice : null;
  if (text) $("ask-who").textContent = text.replace("{account}", account ?? "").replace("{device}", device ?? "");
  else $("ask-who").hidden = true;
  $("ask").hidden = false;
}

async function start() {
  if (location.protocol === "http:") $("http-warn").hidden = false;
  if (!code || !devicePk) return end(T.badLink, "bad");
  try {
    const r = await fetch(api, { cache: "no-store" });
    if (r.status === 410) return end(T.expired, "bad");
    const v = await r.json();
    if (v.username) $("username").value = v.username;
    showAsker(v.requester);
    if (v.state === "done") return end(T.done, "ok");
    if (v.state === "failed") return end(T.failed, "bad");
    $("form").hidden = false;
    $("form").addEventListener("submit", send);
    if (v.state === "sealed" || v.state === "taken") { $("send").disabled = true; say(T.waiting); follow(v.state); }
    else (v.username ? $("password") : $("username")).focus();
  } catch { say(T.network, "bad"); }
}

start();
