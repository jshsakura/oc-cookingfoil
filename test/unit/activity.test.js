import { test } from "node:test";
import assert from "node:assert/strict";
import { createActivity, JobStopped } from "../../src/tasks/activity.js";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("a job runs, steps and ends in the recent list with its time", () => {
  let t = 1000;
  const a = createActivity({ now: () => t });
  const job = a.begin("scan:saves", { title: "세이브 폴더를 읽습니다", total: 3 });
  job.step(2, "0100000000010000");
  let snap = a.list();
  assert.equal(snap.running.length, 1);
  assert.deepEqual(
    { kind: snap.running[0].kind, current: snap.running[0].current, total: snap.running[0].total, detail: snap.running[0].detail },
    { kind: "scan:saves", current: 2, total: 3, detail: "0100000000010000" },
  );
  t = 1500;
  job.done("3개");
  snap = a.list();
  assert.equal(snap.running.length, 0);
  assert.equal(snap.recent[0].state, "done");
  assert.equal(snap.recent[0].result, "3개");
  assert.equal(snap.recent[0].ms, 500);
});

test("a failed job keeps its reason, and an ended handle does nothing more", () => {
  const a = createActivity();
  const job = a.begin("backup");
  job.fail(new Error("disk full"));
  job.step(5);
  job.done("again");
  const { running, recent } = a.list();
  assert.equal(running.length, 0);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].state, "failed");
  assert.equal(recent[0].error, "disk full");
});

test("a discarded job leaves no trace", () => {
  const a = createActivity();
  a.begin("ratings").discard();
  assert.deepEqual(a.list(), { running: [], recent: [] });
});

test("the recent list keeps at most the limit, and only for the keeping time", () => {
  let t = 0;
  const a = createActivity({ now: () => t, recentMax: 3, recentMs: 1000 });
  for (let i = 0; i < 5; i++) a.begin("sync", { title: `#${i}` }).done();
  assert.deepEqual(a.list().recent.map((e) => e.title), ["#4", "#3", "#2"]);
  t = 2000;
  assert.equal(a.list().recent.length, 0);
});

test("listeners get one snapshot per flush window however often jobs step", async () => {
  const a = createActivity({ flushMs: 20 });
  const seen = [];
  const off = a.subscribe((snap) => seen.push(snap));
  const job = a.begin("nsz", { total: 100 });
  for (let i = 1; i <= 50; i++) job.step(i);
  await tick(60);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].running[0].current, 50);
  off();
  job.done();
  await tick(60);
  assert.equal(seen.length, 1, "no message after unsubscribing");
});

test("a probe fills in progress while someone listens", async () => {
  const a = createActivity({ flushMs: 5, probeMs: 10 });
  let bytes = 0;
  a.begin("nsz", { probe: () => ({ current: (bytes += 10), total: 100, detail: "game.nsp" }) });
  const seen = [];
  const off = a.subscribe((snap) => seen.push(snap));
  await tick(60);
  off();
  const last = seen.at(-1).running[0];
  assert.ok(last.current > 0);
  assert.equal(last.total, 100);
  assert.equal(last.detail, "game.nsp");
});

test("track ends the job with the summary, or as failed and rethrows", async () => {
  const a = createActivity();
  const r = await a.track("titledb", { title: "titledb" }, async (job) => { job.step(1); return 7; }, (n) => `${n}개`);
  assert.equal(r, 7);
  await assert.rejects(a.track("eshop", {}, async () => { throw new Error("offline"); }), /offline/);
  const [failed, ok] = a.list().recent;
  assert.equal(ok.result, "7개");
  assert.equal(failed.error, "offline");
});

test("long text is cut and bad counts are dropped", () => {
  const a = createActivity();
  const job = a.begin("sync", { title: "x".repeat(500), total: -3 });
  job.step(Number.NaN, "y".repeat(500));
  const e = a.list().running[0];
  assert.equal(e.title.length, 200);
  assert.equal(e.detail.length, 200);
  assert.equal(e.total, null);
  assert.equal(e.current, 0);
});

test("a job begun with cancel() can be stopped once, and ends in recent as stopped", () => {
  const a = createActivity();
  let asked = 0;
  const job = a.begin("verify", { title: "게임 파일을 검사합니다", total: 10, cancel: () => { asked++; } });
  const plain = a.begin("backup");
  let snap = a.list();
  assert.equal(snap.running.find((e) => e.id === job.id).cancellable, true);
  assert.equal(snap.running.find((e) => e.id === plain.id).cancellable, true, "every job can be stopped");

  assert.equal(a.cancel("a999"), false);
  assert.equal(a.cancel(job.id), true);
  assert.equal(a.cancel(job.id), false);
  assert.equal(asked, 1);
  snap = a.list();
  const e = snap.running.find((x) => x.id === job.id);
  assert.equal(e.detail, "중지하는 중");
  assert.equal(e.cancellable, false);
  job.step(3, "next.nsp");
  assert.equal(a.list().running.find((x) => x.id === job.id).detail, "중지하는 중");

  job.done("3개");
  const ended = a.list().recent[0];
  assert.equal(ended.state, "stopped");
  assert.equal(ended.result, "3개");
  assert.equal(ended.detail, null);
  assert.equal("stopping" in ended, false);
  assert.equal(a.cancel(job.id), false);
});

test("a stopped job that is discarded or fails still shows as stopped", () => {
  const a = createActivity();
  const one = a.begin("verify", { cancel: () => {} });
  const two = a.begin("nsz", { cancel: () => { two.fail(new Error("killed")); } });
  a.cancel(one.id);
  one.discard();
  a.cancel(two.id);
  const { running, recent } = a.list();
  assert.equal(running.length, 0);
  assert.deepEqual(recent.map((e) => [e.kind, e.state, e.error]), [["nsz", "stopped", undefined], ["verify", "stopped", undefined]]);
});

test("a job without its own cancel() sees stopped and winds down; track() keeps a JobStopped out of the failures", async () => {
  const a = createActivity();
  const job = a.begin("scan:saves", { title: "세이브 폴더를 읽습니다" });
  assert.equal(job.stopped, false);
  assert.equal(a.cancel(job.id), true);
  assert.equal(job.stopped, true);
  job.done();
  assert.equal(a.list().recent[0].state, "stopped");

  const run = a.track("scan:patches", { title: "패치 폴더를 읽습니다" }, async (j) => {
    a.cancel(j.id);
    if (j.stopped) throw new JobStopped();
  });
  await assert.rejects(run, JobStopped);
  assert.equal(a.list().recent[0].state, "stopped");
});
