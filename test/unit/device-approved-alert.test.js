import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// An approval the admin did not make (an account's QR, a download, a sign-in) is told to the admin; one the
// admin made is not told back. The page the QR leads to ends with a way home.
const dir = mkdtempSync(path.join(tmpdir(), "cook-device-approved-"));
process.env.COOK_DATA_DIR = dir;
process.env.COOK_DEVICE_PAIRING = "true";
process.env.COOK_DEVICE_AUTO_APPROVE = "false";
const store = await import("../../src/security/store.js");
const alerts = await import("../../src/helpers/alerts.js");
const { approveWaitingDevice, approvePairLink, approveSignedInDevice } = await import("../../src/security/pairing-approve.js");
const { issuePairLink } = await import("../../src/security/pairing-link.js");
const { devicePage } = await import("../../src/routes/login-page.js");
after(() => rmSync(dir, { recursive: true, force: true }));

const newKey = () => crypto.randomBytes(32).toString("hex").toUpperCase();
const told = () => alerts.recent().filter((e) => e.event === "deviceApproved");

test("a console an account approves by QR, or a sign-in approves, is told; the admin's own approval is not", () => {
  const byQr = newKey();
  store.recordPendingDevice(byQr, { quiet: true });
  assert.equal(approvePairLink(issuePairLink(byQr).token, { addedBy: "alice", label: "거실" }), "ok");
  let said = told();
  assert.equal(said.length, 1);
  assert.match(said[0].texts.ko, /QR/);
  assert.match(said[0].texts.ko, /거실/);
  assert.match(said[0].texts.ko, /Switch/);

  assert.equal(approveSignedInDevice(newKey(), "alice"), true);
  said = told();
  assert.equal(said.length, 2);
  assert.ok(said.some((e) => /자동 승인/.test(e.texts.ko)));

  const byAdmin = newKey();
  store.recordPendingDevice(byAdmin, { quiet: true });
  assert.equal(approveWaitingDevice(byAdmin, { addedBy: "admin" }).ok, true);
  assert.equal(told().length, 2, "the admin is not told of their own approval");
});

test("the approved page offers a way back to the dashboard in every language", () => {
  for (const lang of ["ko", "en", "ja", "zh"]) assert.match(devicePage({ lang, view: "done" }), /<a class="button" href="\/">/, lang);
  assert.match(devicePage({ lang: "ko", view: "done" }), /대시보드로 돌아가기/);
});
