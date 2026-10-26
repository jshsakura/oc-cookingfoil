import { test } from "node:test";
import assert from "node:assert/strict";
import { readCerts, ticketSigned } from "../../src/meta/ticket-sign.js";
import { signedHelp } from "../../src/meta/signed-help.js";
import { SIGNED_WORDS } from "../../src/meta/signed-words.js";
import { chain, ticket } from "../support/ticket-files.js";

test("the .cert file reads as its certificates with names, issuers and keys", () => {
  const certs = readCerts(chain().certFile);
  assert.deepEqual(certs.map((c) => [c.issuer, c.name, Boolean(c.key)]), [["Root", "CA00000003", true], ["Root-CA00000003", "XS00000020", true]]);
});

test("a ticket signed by the package's XS certificate, itself signed by its CA, is signed", () => {
  assert.equal(ticketSigned(ticket(), chain().certFile), true);
  assert.equal(ticketSigned(ticket({ bigEndian: true }), chain().certFile), true, "the signature type in either byte order");
});

test("a made-up ticket signature is not signed", () => {
  assert.equal(ticketSigned(ticket({ fake: true }), chain().certFile), false);
});

test("a ticket changed after signing is not signed", () => {
  const t = ticket();
  t[t.length - 1] ^= 1;
  assert.equal(ticketSigned(t, chain().certFile), false);
});

test("a ticket whose signer is missing, or whose XS certificate lacks its CA, is not signed", () => {
  assert.equal(ticketSigned(ticket({ issuer: "Root-CA00000003-XS00000099" }), chain().certFile), false);
  assert.equal(ticketSigned(ticket(), chain().xsCert), false);
  assert.equal(ticketSigned(ticket(), Buffer.alloc(0)), false);
});

test("an XS certificate the CA did not sign does not vouch for its ticket", () => {
  const { caCert, xsCert } = chain();
  const forged = Buffer.from(xsCert);
  // A byte of the body past the name and before the key: the CA's signature no longer holds.
  forged[0x240 + 0x84] ^= 1;
  assert.equal(ticketSigned(ticket(), Buffer.concat([caCert, forged])), false);
});

test("garbage never throws and is not signed", () => {
  assert.equal(ticketSigned(Buffer.from("not a ticket"), chain().certFile), false);
  assert.equal(ticketSigned(null, null), false);
  assert.deepEqual(readCerts(Buffer.alloc(16, 0xaa)), []);
});

test("the help names what is unsigned, in the reader's language, and is absent when nothing is false", () => {
  assert.equal(signedHelp({ nca: true, ticket: true }, "ko"), null);
  assert.equal(signedHelp({}, "ko"), null);
  assert.deepEqual(signedHelp({ nca: false }, "ko"), { title: SIGNED_WORDS.ko.title, body: SIGNED_WORDS.ko.nca });
  assert.deepEqual(signedHelp({ nca: true, ticket: false }, "ja"), { title: SIGNED_WORDS.ja.title, body: SIGNED_WORDS.ja.ticket });
  assert.deepEqual(signedHelp({ nca: false, ticket: false }, "zh-Hant"), { title: SIGNED_WORDS["zh-Hant"].title, body: SIGNED_WORDS["zh-Hant"].both });
  assert.equal(signedHelp({ ticket: false }, "pt-BR").title, SIGNED_WORDS.pt.title);
  assert.equal(signedHelp({ ticket: false }, "xx").title, SIGNED_WORDS.en.title);
});

test("every language has every text, none empty", () => {
  const langs = Object.keys(SIGNED_WORDS);
  assert.deepEqual(langs.sort(), ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "ru", "zh", "zh-Hant"]);
  for (const l of langs) for (const k of ["title", "nca", "ticket", "both"]) assert.ok(SIGNED_WORDS[l][k]?.trim(), `${l}.${k}`);
});
