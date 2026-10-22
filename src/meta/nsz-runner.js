/**
 * One nsz run for the conversion queue (nsz-queue.js): compress and verify a
 * single .nsp (or .xci) into a work folder, as a low-priority child.
 *
 *   nice -n 19 ionice -c 3 nsz -C -V -l <level> -t <threads> [-B] -o <work> <src>
 *
 * nice and ionice are used when the system has them and they work here
 * (busybox on alpine has nice; ionice may be missing) and left out otherwise. The child runs in its
 * own process group so a stop takes nsz's helpers down with it: SIGTERM first,
 * SIGKILL after a short grace. Only the tail of its output is kept, for the
 * failure reason.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { envString } from "../helpers/env-read.js";
import { keysDir } from "../security/prod-keys.js";

const TAIL_CHARS = 4000;
export const REASON_CHARS = 300;

/** The first executable called `name` on PATH, or null. */
function onPath(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

/** The nsz binary: COOK_NSZ_BIN when it is executable, else `nsz` on PATH, else null. Read on each call. */
export function resolveNsz() {
  const explicit = envString("COOK_NSZ_BIN");
  if (explicit) {
    try {
      fs.accessSync(explicit, fs.constants.X_OK);
      return explicit;
    } catch {
      return null;
    }
  }
  return onPath("nsz");
}

let priorityPrefix = null;
/** Whether `argv` followed by `true` runs here (an ionice without the right to set a class fails). */
function works(argv) {
  const truthy = onPath("true");
  if (!truthy) return false;
  try {
    return spawnSync(argv[0], [...argv.slice(1), truthy], { stdio: "ignore", timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

/** [nice -n 19] [ionice -c 3], whichever exist and work; looked up once. */
export function lowPriorityPrefix() {
  if (priorityPrefix) return priorityPrefix;
  const out = [];
  for (const [name, ...rest] of [["nice", "-n", "19"], ["ionice", "-c", "3"]]) {
    const bin = onPath(name);
    if (bin && works([bin, ...rest])) out.push(bin, ...rest);
  }
  priorityPrefix = out;
  return out;
}

/** The nsz arguments for one file. Pure. */
/** nsz's verify flag: the queue deletes an original only after a run with it. */
export const VERIFY_FLAG = "-V";

export function nszArgs({ level, threads, block }, workDir, src) {
  // nsz looks for prod.keys next to itself or in ~/.switch; the server keeps them in its keys folder.
  return ["--keys", keysDir(), "-C", VERIFY_FLAG, "-l", String(level), "-t", String(threads), ...(block ? ["-B"] : []), "-o", workDir, src];
}

/**
 * Lines nsz 5 prints when it skipped a check yet still exits 0: a ticketless container's NCAs are
 * not hashed (Decompressor.py), only marked. Such a run did not verify the result.
 */
export const UNVERIFIED_MARKERS = ["[TICKETLESS]"];
const MARKER_CARRY = Math.max(...UNVERIFIED_MARKERS.map((m) => m.length)) - 1;

/** The text a failure is shown with: the last lines, at most REASON_CHARS. Pure. */
export function trimReason(text) {
  const t = String(text ?? "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join(" / ");
  return t.length > REASON_CHARS ? `…${t.slice(-(REASON_CHARS - 1))}` : t;
}

/** What went wrong, from the exit code and the output's tail. Pure. */
export function failureReason(code, signal, tail) {
  const t = String(tail ?? "");
  if (/hash mismatch|corrupted|verification (failed|exception)|verificationexception/i.test(t)) return { code: "verify", reason: "검증에서 해시가 맞지 않습니다. 원본이 손상되었을 수 있습니다." };
  const detail = trimReason(t);
  const how = signal ? `신호 ${signal}` : `종료 코드 ${code}`;
  return { code: "compress", reason: `압축하지 못했습니다 (${how})${detail ? `: ${detail}` : ""}` };
}

/**
 * Starts nsz. Returns { done, stop }: `done` resolves to { code, signal, tail,
 * stopped, unverified } (`unverified`: an UNVERIFIED_MARKERS line was printed); `stop()` ends the run (SIGTERM, then SIGKILL after `graceMs`)
 * and resolves once the child is gone.
 */
export function runNsz({ bin, args, graceMs = 3000, lowPriority = true }) {
  const argv = [...(lowPriority ? lowPriorityPrefix() : []), bin, ...args];
  let tail = "";
  // The whole stream is searched, a chunk at a time, keeping enough of the last one for a marker split between them.
  let carry = "";
  let unverified = false;
  let stopped = false;
  let exited = false;
  let killTimer = null;
  const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const keep = (chunk) => {
    const text = chunk.toString("utf8");
    if (!unverified) {
      const seen = carry + text;
      unverified = UNVERIFIED_MARKERS.some((m) => seen.includes(m));
      carry = seen.slice(-MARKER_CARRY);
    }
    tail += text;
    if (tail.length > TAIL_CHARS) tail = tail.slice(-TAIL_CHARS);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const signalGroup = (sig) => {
    if (exited) return;
    try { process.kill(-child.pid, sig); } catch {
      try { child.kill(sig); } catch { /* already gone */ }
    }
  };

  const done = new Promise((resolve) => {
    let settled = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      exited = true;
      clearTimeout(killTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, signal, tail, stopped, unverified });
    };
    child.once("error", (err) => { keep(err.message); finish(-1, null); });
    child.once("close", (code, signal) => finish(code, signal));
  });

  function stop() {
    if (!exited && !stopped) {
      stopped = true;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), graceMs);
      killTimer.unref?.();
    }
    return done;
  }

  return { done, stop, pid: child.pid };
}

/** The .nsz/.xcz nsz wrote into `dir`, or null. */
export function findOutput(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const hit = names.find((n) => /\.(nsz|xcz)$/i.test(n));
  return hit ? path.join(dir, hit) : null;
}
