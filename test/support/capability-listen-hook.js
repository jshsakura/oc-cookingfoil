// Preloaded with `node --import` by discoverRoutes() (test/support/capability-routes.js). When the
// app calls listen(), this walks the real Express router instead, prints every route as JSON
// [[method, path], ...] and exits, so no port is opened. Anything it cannot read exactly is an
// error on stderr and exit code 2, never a route quietly left out.
//
// It reads Express 4 internals (app._router, layer.regexp.fast_slash). Moving to Express 5 breaks
// this walk first; update it in the same change.
import { createRequire } from "node:module";

const express = createRequire(import.meta.url)("express");

function nestedPath(layer) {
  if (layer.keys?.length) throw new Error(`nested router with path parameters (${layer.regexp}) is not supported by the coverage walk`);
  if (layer.regexp.fast_slash) return "";
  const src = layer.regexp.source.replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  if (/[()[\]*+?|]/.test(src.replace(/\\\//g, ""))) throw new Error(`cannot read nested router path ${layer.regexp}`);
  return src.replace(/\\\//g, "/").replace(/\\(.)/g, "$1");
}

function walk(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      for (const p of [].concat(layer.route.path)) {
        if (typeof p !== "string") throw new Error(`route ${prefix}${p} is not a string path; the coverage walk needs one`);
        for (const method of Object.keys(layer.route.methods)) out.push([method === "_all" ? "ALL" : method, prefix + p]);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      walk(layer.handle.stack, prefix + nestedPath(layer), out);
    }
  }
}

express.application.listen = function () {
  try {
    const out = [];
    walk(this._router?.stack ?? [], "", out);
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
};
