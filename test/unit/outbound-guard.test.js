import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Operator-set outbound URLs (titledb source, direct address)
// may not point the server at its own network: checked at save time on the
// admin API and again at fetch time, after DNS, on every redirect hop.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-outbound-"));
const guard = await import("../../src/security/outbound-guard.js");
const { blockedReason, checkOutboundUrl, guardedFetch, OutboundError } = guard;

const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address }));

test("private, loopback, link-local, CGNAT and metadata addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.5", "100.64.0.1", "100.127.255.254", "::1", "fc00::1", "fd12:3456::1"]) {
    assert.equal(blockedReason(ip), "private", ip);
  }
  for (const ip of ["169.254.169.254", "169.254.1.1", "fd00:ec2::254", "100.100.100.200", "fe80::1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::"]) {
    assert.equal(blockedReason(ip), "metadata", ip);
  }
});

test("IPv4-mapped and NAT64 forms are judged by the address inside", () => {
  assert.equal(blockedReason("::ffff:127.0.0.1"), "private");
  assert.equal(blockedReason("::ffff:7f00:1"), "private");
  assert.equal(blockedReason("::ffff:a9fe:a9fe"), "metadata");
  assert.equal(blockedReason("64:ff9b::a9fe:a9fe"), "metadata");
  assert.equal(blockedReason("::ffff:203.0.113.4"), null);
});

test("public addresses pass", () => {
  for (const ip of ["203.0.113.10", "198.51.100.7", "2001:db8::1", "100.63.255.255", "100.128.0.1", "172.32.0.1"]) assert.equal(blockedReason(ip), null, ip);
});

test("a hostname that resolves to a private address is refused", async () => {
  await assert.rejects(checkOutboundUrl("https://ratings.example.org", { lookup: resolvesTo("10.0.0.5") }), (err) => err instanceof OutboundError && err.code === "outbound.blocked" && /private network/.test(err.message));
  // Any one bad address among several is enough.
  await assert.rejects(checkOutboundUrl("https://ratings.example.org", { lookup: resolvesTo("203.0.113.5", "127.0.0.1") }), OutboundError);
  const ok = await checkOutboundUrl("https://ratings.example.org/api", { lookup: resolvesTo("203.0.113.5") });
  assert.deepEqual(ok.addresses, ["203.0.113.5"]);
});

test("address literals are checked without DNS, in every spelling the URL parser accepts", async () => {
  const lookup = async () => assert.fail("no lookup for a literal");
  for (const url of ["http://127.0.0.1:8080/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/"]) {
    await assert.rejects(checkOutboundUrl(url, { lookup }), OutboundError, url);
  }
});

test("a name that does not resolve, and a non-http URL, are refused with their own message", async () => {
  await assert.rejects(checkOutboundUrl("https://nowhere.example.org", { lookup: async () => { throw new Error("ENOTFOUND"); } }), (err) => err.reason === "unresolved");
  await assert.rejects(checkOutboundUrl("ftp://files.example.org", { lookup: resolvesTo("203.0.113.5") }), (err) => err.reason === "invalid");
  await assert.rejects(checkOutboundUrl("not a url"), (err) => err.reason === "invalid");
});

test("COOK_OUTBOUND_PRIVATE_HOSTS lets a listed host be private, never link-local or metadata", async () => {
  const privateHosts = new Set(["mirror.example.org"]);
  await checkOutboundUrl("http://mirror.example.org", { lookup: resolvesTo("100.101.102.103"), privateHosts });
  await assert.rejects(checkOutboundUrl("http://other.example.org", { lookup: resolvesTo("100.101.102.103"), privateHosts }), OutboundError);
  await assert.rejects(checkOutboundUrl("http://mirror.example.org", { lookup: resolvesTo("169.254.169.254"), privateHosts }), OutboundError);
});

test("guardedFetch checks every redirect hop", async () => {
  const lookup = async (host) => [{ address: host === "inside.example.org" ? "192.168.1.1" : "203.0.113.9" }];
  const asked = [];
  const fetchImpl = async (url, opts) => {
    asked.push(url);
    assert.equal(opts.redirect, "manual");
    if (url.startsWith("https://start.example.org")) return { status: 302, headers: new Headers({ location: "https://inside.example.org/secret" }) };
    return { status: 200, headers: new Headers() };
  };
  await assert.rejects(guardedFetch("https://start.example.org/", {}, { fetchImpl, lookup }), OutboundError);
  assert.deepEqual(asked, ["https://start.example.org/"], "the private hop was never asked");
  // And a literal metadata address in a Location header.
  const toMetadata = async () => ({ status: 301, headers: new Headers({ location: "http://169.254.169.254/" }) });
  await assert.rejects(guardedFetch("https://start.example.org/", {}, { fetchImpl: toMetadata, lookup }), OutboundError);
  const fine = await guardedFetch("https://public.example.org/", {}, { fetchImpl, lookup });
  assert.equal(fine.status, 200);
});

// ── The admin API refuses them at save time, with a Korean message ─────────
const express = (await import("express")).default;
const { mountServerSettingsApi } = await import("../../src/routes/admin/server-settings-api.js");

const router = express.Router();
router.use(express.json());
mountServerSettingsApi(router, () => true);
const app = express();
app.use("/admin", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  guard.setLookupForTests(null);
});
const post = (url, body) => fetch(`${BASE}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test("saving a titledb source or direct address inside the private network is refused", async () => {
  guard.setLookupForTests(resolvesTo("192.168.10.10"));
  for (const field of ["titledbSource", "publicDirectBaseUrl"]) {
    const r = await post("/admin/api/server-settings", { [field]: "https://mirror.example.org" });
    assert.equal(r.status, 400, field);
    assert.equal(r.body.code, "outbound.blocked", field);
    assert.equal(r.body.field, field);
    assert.match(r.body.error, /private network/, "English without Accept-Language");
  }
  const ko = await fetch(`${BASE}/admin/api/server-settings`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "ko" }, body: JSON.stringify({ titledbSource: "https://mirror.example.org" }) });
  assert.match((await ko.json()).error, /내부망/, "the admin page reads its own language");
  guard.setLookupForTests(null);
});
