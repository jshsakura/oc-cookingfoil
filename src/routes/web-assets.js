import express from "express";
import { fileURLToPath } from "node:url";

// /assets sits behind the shop's sign-in, so a shared cache must not keep it.
export const ASSET_CACHE_CONTROL = "private, max-age=3600";

export default express.static(fileURLToPath(new URL("../views/assets/", import.meta.url)), {
  index: false,
  cacheControl: false,
  fallthrough: false,
  setHeaders: (res) => res.setHeader("Cache-Control", ASSET_CACHE_CONTROL),
});
