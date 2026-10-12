import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const UA = "Mozilla/5.0 (X11; Linux x86_64) oc-cookingfoil-kpatch";
const TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

let githubToken;
function ghToken() {
  if (githubToken !== undefined) return githubToken;
  githubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (!githubToken) {
    try {
      githubToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      githubToken = "";
    }
  }
  return githubToken;
}

function headersFor(url) {
  const h = { "User-Agent": UA };
  if (url.startsWith("https://api.github.com/") && ghToken()) h.Authorization = `Bearer ${ghToken()}`;
  if (/dcinside\.com/.test(url)) h.Referer = "https://gall.dcinside.com/";
  return h;
}

/** GET returning { status, text }; network errors become status 0. */
export async function getText(url) {
  try {
    const res = await fetch(url, { headers: headersFor(url), signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: res.status, text: res.ok ? await res.text() : "" };
  } catch (err) {
    return { status: 0, text: "", error: err.message };
  }
}

export async function getJson(url) {
  const r = await getText(url);
  if (r.status !== 200) return { status: r.status, json: null };
  try {
    return { status: 200, json: JSON.parse(r.text) };
  } catch {
    return { status: 200, json: null };
  }
}

/** Download to `file` through a .part file, so a cut download never looks finished. */
export async function download(url, file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: headersFor(url), redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/html")) throw new Error(`파일 대신 웹 페이지가 왔습니다: ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${file}.part`));
  await fsp.rename(`${file}.part`, file);
  return { file, size: (await fsp.stat(file)).size };
}
