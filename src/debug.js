/**
 * Debug namespaces for CookingFoil.
 *
 * Namespacing lets the user dial verbosity up or down without code
 * changes:
 *
 *   DEBUG=oc-cookingfoil,oc-cookingfoil:err   (default — info + errors)
 *   DEBUG=oc-cookingfoil*                     (everything, incl. cache traces)
 *   DEBUG=oc-cookingfoil:cache                (just the icon cache I/O lines)
 *
 * Categories:
 *   oc-cookingfoil           general info (boot, builds, titledb refresh)
 *   oc-cookingfoil:err       errors anywhere in the pipeline
 *   oc-cookingfoil:request   incoming HTTP requests
 *   oc-cookingfoil:cache     per-image cache hits / misses / transcodes
 *                            (high-frequency during the icon prewarm pass)
 *   oc-cookingfoil:file      legacy file watcher events
 *   oc-cookingfoil:ftp       legacy FTP events
 */
import debug from "debug";

const log   = debug("oc-cookingfoil");
const http  = debug("oc-cookingfoil:request");
const file  = debug("oc-cookingfoil:file");
const ftp   = debug("oc-cookingfoil:ftp");
const error = debug("oc-cookingfoil:err");
const cache = debug("oc-cookingfoil:cache");

export default { http, file, log, ftp, error, cache };
