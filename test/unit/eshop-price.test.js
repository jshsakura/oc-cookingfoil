import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eshopPrice, clearPriceCache, fetchPrices, cachedPrice, warmPrices, onPricesChanged } from "../../src/meta/eshop-price.js";

const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

beforeEach(() => clearPriceCache());

test("eshopPrice reads the KR regular and discount price", async () => {
  const fetchImpl = reply({ prices: [{ sales_status: "onsale",
    regular_price: { amount: "64,800원" }, discount_price: { amount: "45,360원", end_datetime: "2026-10-20T14:59:59Z" } }] });
  assert.deepEqual(await eshopPrice("70010000009373", { fetchImpl }),
    { country: "KR", regular: "64,800원", discount: "45,360원", discountEnds: "2026-10-20T14:59:59Z" });
});

test("eshopPrice falls back to the next region when KR does not sell it", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(new URL(url).searchParams.get("country"));
    const onsale = url.includes("country=US");
    return { ok: true, json: async () => ({ prices: [onsale
      ? { sales_status: "onsale", regular_price: { amount: "$19.99" } }
      : { sales_status: "not_found" }] }) };
  };
  const price = await eshopPrice("70010000000001", { fetchImpl });
  assert.equal(price.country, "US");
  assert.deepEqual(asked, ["KR", "US"]);
});

test("eshopPrice caches results and rejects bad ids", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ prices: [{ sales_status: "not_found" }] }) }; };
  assert.equal(await eshopPrice("70010000000002", { fetchImpl }), null);
  assert.equal(await eshopPrice("70010000000002", { fetchImpl }), null);
  assert.equal(calls, 3);
  assert.equal(await eshopPrice("abc", { fetchImpl }), null);
  assert.equal(await eshopPrice(null, { fetchImpl }), null);
});

test("a network failure is not saved as unsold, and is asked again only after half an hour", async () => {
  let calls = 0;
  let offline = true;
  let at = Date.parse("2026-10-19T00:00:00Z");
  const now = () => at;
  const fetchImpl = async () => {
    calls++;
    if (offline) throw new Error("offline");
    return { ok: true, json: async () => ({ prices: [{ sales_status: "onsale", regular_price: { amount: "1원" } }] }) };
  };
  assert.equal(await eshopPrice("70010000000003", { fetchImpl, now }), null);
  assert.equal(calls, 3);
  assert.equal(cachedPrice("70010000000003"), undefined, "unknown, not unsold");
  at += 29 * 60_000;
  assert.equal(await eshopPrice("70010000000003", { fetchImpl, now }), null);
  assert.equal(calls, 3, "left alone within the half hour");
  at += 2 * 60_000;
  offline = false;
  assert.equal((await eshopPrice("70010000000003", { fetchImpl, now })).regular, "1원");
  assert.equal(calls, 4);
});

test("a title no eShop sells is asked again after a day, not every six hours", async () => {
  let calls = 0;
  let at = Date.parse("2026-10-19T00:00:00Z");
  const now = () => at;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ prices: [{ title_id: 70010000000004, sales_status: "not_found" }] }) }; };
  await warmPrices(["70010000000004"], { fetchImpl, now, paceMs: 0 });
  assert.equal(calls, 3);
  at += 23 * 3_600_000;
  await warmPrices(["70010000000004"], { fetchImpl, now, paceMs: 0 });
  assert.equal(calls, 3);
  at += 2 * 3_600_000;
  await warmPrices(["70010000000004"], { fetchImpl, now, paceMs: 0 });
  assert.equal(calls, 6);
});

test("fetchPrices asks 50 ids per request and falls back per id to the next region", async () => {
  const asked = [];
  const ids = Array.from({ length: 60 }, (_, i) => String(70010000000100 + i));
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    const batch = params.get("ids").split(",");
    asked.push([params.get("country"), batch.length]);
    const prices = batch.map((id) => (params.get("country") === "KR" && id !== ids[0]) || params.get("country") === "US"
      ? { title_id: Number(id), sales_status: "onsale", regular_price: { amount: params.get("country") + id } }
      : { title_id: Number(id), sales_status: "not_found" });
    return { ok: true, json: async () => ({ prices }) };
  };
  const changed = await fetchPrices(ids, { fetchImpl, paceMs: 0 });
  assert.equal(changed, 60);
  assert.deepEqual(asked, [["KR", 50], ["KR", 10], ["US", 1]]);
  assert.equal(cachedPrice(ids[0]).country, "US");
  assert.equal(cachedPrice(ids[1]).regular, `KR${ids[1]}`);
  assert.equal(cachedPrice("70010000009999"), undefined, "never asked is unknown, not missing");
});

test("a failed batch stays unknown, and rebuilds leave it alone for half an hour", async () => {
  const ids = ["70010000000200"];
  let calls = 0;
  let at = Date.parse("2026-10-19T00:00:00Z");
  const now = () => at;
  const fetchImpl = async () => { calls++; return { ok: false }; };
  await warmPrices(ids, { fetchImpl, now, paceMs: 0 });
  assert.equal(cachedPrice(ids[0]), undefined);
  const first = calls;
  for (let i = 0; i < 5; i++) {
    at += 15_000;
    await warmPrices(ids, { fetchImpl, now, paceMs: 0 });
  }
  assert.equal(calls, first, "a rebuild every 15 seconds asks nothing");
  at += 30 * 60_000;
  await warmPrices(ids, { fetchImpl, now, paceMs: 0 });
  assert.ok(calls > first);
});

test("old prices the library no longer asks about are dropped from the saved cache", async () => {
  const { loadPrices } = await import("../../src/meta/eshop-price.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prices-")), "prices.json");
  const at = Date.parse("2026-10-19T00:00:00Z");
  const old = at - 8 * 24 * 3_600_000;
  const price = { country: "KR", regular: "1원", discount: null, discountEnds: null };
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    ["70010000000500", { at: old, value: price }],
    ["70010000000501", { at: at - 3_600_000, value: price }],
    ["70010000000502", { at: old - 1, value: price }],
  ] }));
  loadPrices(file);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ prices: [] }) }; };
  // 500 is old but still in the library, so it is refreshed, not dropped; 502 is old and gone.
  await warmPrices(["70010000000500", "70010000000501"], { fetchImpl, now: () => at, paceMs: 0 });
  assert.ok(calls > 0);
  const saved = new Map(JSON.parse(fs.readFileSync(file, "utf8")).entries);
  assert.ok(saved.has("70010000000500"));
  assert.ok(saved.has("70010000000501"));
  assert.equal(saved.has("70010000000502"), false);
  clearPriceCache();
});

test("warmPrices tells listeners only when a price changed, and skips fresh ones", async () => {
  let heard = 0;
  onPricesChanged(() => heard++);
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ prices: [{ title_id: 70010000000300, sales_status: "onsale", regular_price: { amount: "1원" } }] }) };
  };
  await warmPrices(["70010000000300"], { fetchImpl, paceMs: 0 });
  await warmPrices(["70010000000300"], { fetchImpl, paceMs: 0 });
  assert.equal(calls, 1);
  assert.equal(heard, 1);
});

test("a sale past its end date is left out of the item fields", async () => {
  const { priceFields } = await import("../../src/create-index-content.js");
  const price = { regular: "23,220원", country: "KR", discount: "11,610원", discountEnds: "2026-10-28T14:59:59Z" };
  const before = Date.parse("2026-10-20T00:00:00Z");
  const after = Date.parse("2026-10-29T00:00:00Z");
  assert.equal(priceFields(price, before).price_discount, "11,610원");
  assert.equal(priceFields(price, before).price_discount_ends, "2026-10-28T14:59:59Z");
  assert.deepEqual(priceFields(price, after), { price_regular: "23,220원", price_country: "KR" });
});

test("prices survive a restart through the saved cache", async () => {
  const { loadPrices } = await import("../../src/meta/eshop-price.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prices-")), "prices.json");
  clearPriceCache();
  loadPrices(file);
  const body = { prices: [{ title_id: 70010000000001, sales_status: "onsale", regular_price: { amount: "10,000원" } }] };
  await warmPrices(["70010000000001"], { fetchImpl: reply(body), paceMs: 0 });
  assert.ok(fs.existsSync(file));
  clearPriceCache();
  assert.equal(cachedPrice("70010000000001"), undefined);
  assert.equal(loadPrices(file), 1);
  assert.equal(cachedPrice("70010000000001").regular, "10,000원");
  clearPriceCache();
});
