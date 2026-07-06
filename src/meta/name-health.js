/**
 * Name-source health — WHY game names resolve (or collapse to filenames).
 *
 * Display names come from three layers, in priority order:
 *   1. titledb   — fetched at runtime from blawar/titledb over the WEB. NOT
 *                  shipped in the image (data/* is gitignored). If GitHub is
 *                  unreachable on a fresh box, this layer is empty.
 *   2. NACP extraction — read straight out of the game container. Two sub-cases:
 *        · .nro         needs nothing (pure-JS parser)
 *        · .nsp / .xci  need `nstool` + `prod.keys` ON THE SERVER
 *   3. filename fallback — last resort. Produces garbage like
 *                  `[0100000000010000][v0]`.
 *
 * When titledb never fetched AND NSP/XCI extraction can't run, every NSP/XCI
 * title falls to layer 3 — and until now that failed SILENTLY. This module
 * computes a machine-readable verdict so /healthz, the dashboard and the boot
 * log can all SHOW the operator which source is (not) working.
 *
 * Verdict:
 *   "ok"            titledb has titles OR NSP/XCI extraction is capable.
 *   "filename-only" titledb empty AND neither NSP/XCI nor .nro extraction runs
 *                   — names WILL be garbage. The loud red state.
 *   "degraded"      exactly one source works (partial coverage) — e.g. titledb
 *                   empty but .nro extraction is on (nsp/xci still fall back).
 *
 * The probe logic is NOT duplicated here: the nstool binary + prod.keys checks
 * are reused from the nsp extractor's own `status()` (single source of truth).
 * A failed probe degrades to `false`, never a crash.
 */
import debug from "../debug.js";
import * as titledbStore from "./titledb-store.js";
import * as nsp from "./extract-providers/nsp.js";
import { extractIcons } from "../helpers/envs.js";

/**
 * Pure verdict function — no I/O, fully unit-testable.
 * @param {{titledbTitles:number, nspXciCapable:boolean, nroCapable:boolean}} x
 * @returns {"ok"|"degraded"|"filename-only"}
 */
export function verdictFor({ titledbTitles, nspXciCapable, nroCapable }) {
  if (titledbTitles > 0 || nspXciCapable) return "ok";
  // titledb empty AND no NSP/XCI names from this point on.
  if (!nroCapable) return "filename-only";
  return "degraded";
}

/**
 * Pure builder — assembles the health object from already-probed inputs.
 * Booleans are coerced so a stray truthy path string still reads as `true`.
 * @param {{titledbTitles:number, titledbRegions:string[], mode:string,
 *          nstool:boolean, prodKeys:boolean}} input
 */
export function buildNameHealth({
  titledbTitles = 0,
  titledbRegions = [],
  mode = "all",
  nstool = false,
  prodKeys = false,
} = {}) {
  const extractionOn = mode !== "off";
  const nspXciCapable = extractionOn && Boolean(nstool) && Boolean(prodKeys);
  const nroCapable = extractionOn;
  const verdict = verdictFor({
    titledbTitles,
    nspXciCapable,
    nroCapable,
  });
  return {
    titledb: {
      titles: titledbTitles,
      regions: Array.isArray(titledbRegions) ? titledbRegions : [],
    },
    extraction: {
      mode,
      nstool: Boolean(nstool),
      prodKeys: Boolean(prodKeys),
      nspXciCapable, // can read names out of NSP/XCI
      nroCapable, // .nro needs no keys
    },
    verdict,
  };
}

/** Read the loaded titledb size + region list. Never throws. */
function readTitledb() {
  try {
    const s = titledbStore.status();
    const regions = Array.isArray(s.regions)
      ? s.regions.map((r) => r.region).filter(Boolean)
      : [];
    return { titledbTitles: s.titles ?? 0, titledbRegions: regions };
  } catch (err) {
    debug.error("name-health: titledb status probe failed: %s", err.message);
    return { titledbTitles: 0, titledbRegions: [] };
  }
}

/** Probe nstool + prod.keys via the nsp extractor's own status (DRY). */
async function readExtraction() {
  try {
    const st = await nsp.status();
    return { nstool: Boolean(st.bin), prodKeys: Boolean(st.keysPresent) };
  } catch (err) {
    debug.error("name-health: extraction probe failed: %s", err.message);
    return { nstool: false, prodKeys: false };
  }
}

/**
 * Live health snapshot for THIS server. Gathers titledb + extraction state and
 * returns the full object. Any probe failure degrades to a safe default.
 */
export async function getNameHealth() {
  const { titledbTitles, titledbRegions } = readTitledb();
  const { nstool, prodKeys } = await readExtraction();
  return buildNameHealth({
    titledbTitles,
    titledbRegions,
    mode: extractIcons,
    nstool,
    prodKeys,
  });
}

/** One-line human summary of the extraction sub-state (for logs). */
function extractionSummary(ex) {
  if (ex.mode === "off") return "disabled: extraction off";
  if (!ex.nstool) return "disabled: no nstool";
  if (!ex.prodKeys) return "disabled: no prod.keys";
  return "enabled";
}

/**
 * Emit one clear boot line. filename-only logs at error level (oc-cookingfoil:err)
 * so it stands out; otherwise info. Never throws.
 */
export async function logNameHealth() {
  try {
    const nh = await getNameHealth();
    const line =
      `[name-health] titledb=${nh.titledb.titles} titles, ` +
      `NSP extraction=${extractionSummary(nh.extraction)}, ` +
      `verdict=${nh.verdict}`;
    if (nh.verdict === "filename-only") {
      debug.error(
        "%s — names WILL fall back to filenames. Make titledb reach github, " +
          "or add prod.keys on the server.",
        line
      );
    } else {
      debug.log(line);
    }
    return nh;
  } catch (err) {
    debug.error("name-health: boot log failed: %s", err.message);
    return null;
  }
}
