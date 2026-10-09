import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eshopPrice, clearPriceCache } from "../../src/meta/eshop-price.js";

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

test("eshopPrice does not cache network failures", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("offline"); };
  assert.equal(await eshopPrice("70010000000003", { fetchImpl }), null);
  assert.equal(await eshopPrice("70010000000003", { fetchImpl }), null);
  assert.equal(calls, 6);
});
