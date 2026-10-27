/**
 * Plugins the project recommends, installed from their repository's latest GitHub release.
 *
 *   RECOMMENDED                                   [{ id, repo, asset, name }] (the page words each one's description as pl.r.<id>)
 *   downloadRecommended(id, { fetchImpl, token }) -> { zip: Buffer, tag, sha256 }
 *   installRecommended(id, { registry, installer, overwrite, ... }) -> registry view, installed switched off
 *   installChosen(ids, { registry, installer, ... }) -> [{ id, ok, error? }]   what first-run setup picked:
 *                                                 each fetched (unless already in) and switched on
 *
 * The zip is checked against the sha256 GitHub publishes for the asset before anything reads it, and
 * then goes through the same staging as an upload (installer.js), so the admin sees the same
 * question and the plugin still arrives switched off. Only ids on this list can be fetched.
 */
import crypto from "node:crypto";
import { digestHex } from "../meta/client-release.js";
import { PluginError } from "./registry.js";
import { UNPACK_LIMITS } from "./unpack.js";

const USER_AGENT = "oc-cookingfoil";
const API_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;

export const RECOMMENDED = Object.freeze([
  Object.freeze({
    id: "oc-retro-db",
    repo: "jshsakura/oc-retro-database",
    asset: /^oc-retro-db-\d+\.\d+\.\d+\.zip$/,
    name: "OC Retro Database",
  }),
]);

export const recommendedOf = (id) => RECOMMENDED.find((r) => r.id === id) ?? null;

export async function downloadRecommended(id, { fetchImpl = fetch, token = null } = {}) {
  const r = recommendedOf(id);
  if (!r) throw new PluginError("not-found", 404);
  const headers = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetchImpl(`https://api.github.com/repos/${r.repo}/releases/latest`, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new PluginError("fetch-failed", 502, { reason: `release ${res.status}` });
  const release = await res.json();
  const asset = (release.assets ?? []).find((a) => r.asset.test(a.name));
  const want = digestHex(asset?.digest);
  if (!asset || !want) throw new PluginError("fetch-failed", 502, { reason: "no asset" });
  if (!(asset.size > 0) || asset.size > UNPACK_LIMITS.zipBytes) throw new PluginError("fetch-failed", 502, { reason: "size" });

  const dl = await fetchImpl(asset.browser_download_url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!dl.ok) throw new PluginError("fetch-failed", 502, { reason: `download ${dl.status}` });
  const zip = Buffer.from(await dl.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  if (zip.length !== asset.size || sha256 !== want) throw new PluginError("fetch-failed", 502, { reason: "digest" });
  return { zip, tag: release.tag_name ?? null, sha256 };
}

/** Fetches one recommended plugin and installs it, switched off; an installed one is replaced only with overwrite. */
export async function installRecommended(id, { registry, installer, overwrite = false, fetchImpl, token }) {
  const r = recommendedOf(id);
  if (!r) throw new PluginError("not-found", 404);
  const { zip, tag } = await downloadRecommended(id, { fetchImpl, token });
  const { stagedId } = await installer.stage(zip, { id, repo: r.repo, tag });
  try {
    return await installer.confirm(stagedId, { overwrite });
  } catch (err) {
    await installer.discard();
    throw err;
  }
}

/**
 * Installs and switches on the recommended plugins the admin picked in first-run setup. One that is
 * already installed is only switched on. A failure is reported for that id and the rest go on; the
 * admin page's plugin screen fetches it again later.
 */
export async function installChosen(ids, { registry, installer, fetchImpl, token, log = () => {} }) {
  const results = [];
  for (const id of new Set(ids)) {
    try {
      if (!recommendedOf(id)) throw new PluginError("not-found", 404);
      if (!registry.list().some((p) => p.id === id)) await installRecommended(id, { registry, installer, fetchImpl, token });
      await registry.setEnabled(id, true);
      log(`installed the recommended plugin ${id}`);
      results.push({ id, ok: true });
    } catch (err) {
      log(`the recommended plugin ${id} was not installed: ${err.message}`);
      results.push({ id, ok: false, error: err.code ?? err.message });
    }
  }
  return results;
}
