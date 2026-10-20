/**
 * After prod.keys came or went: everything that reads them looks again, with
 * no restart. The readers already ask security/prod-keys.js for the file on
 * every use; this drops what they remembered from the time without keys.
 *
 *   nstool          looked up again on its next use
 *   NACP extractor  titles tried without keys are tried again
 *   install facts   files that could not be read are read again
 *   the list        rebuilt with names read again, which queues both of the above
 *
 * Shortcut builds need nothing: they check the keys file on every request.
 */
import * as nsp from "./extract-providers/nsp.js";
import * as nacpExtractor from "./nacp-extractor.js";
import * as contentMeta from "./content-meta.js";
import * as shopCache from "./shop-cache.js";
import debug from "../debug.js";

export function keysChanged() {
  nsp.recheck();
  nacpExtractor.forgetTried();
  const retried = contentMeta.retryFailed();
  shopCache.invalidate({ rename: true });
  debug.log("prod.keys changed: reading the library again (%d files to retry)", retried);
}
