/**
 * GET / → CookingFoil landing page.
 *
 * Renders the dashboard HTML and replaces a `__VERSION__` token with the
 * current package.json version so the footer chip stays accurate without
 * a build step. The page itself calls /shop.json client-side to populate
 * stats and the recent-games grid — so the auth credentials the browser
 * already negotiated for the page load are reused automatically.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.js";
import debug from "../debug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../views/landing.html");

let cachedHtml = null;

async function loadTemplate() {
  if (cachedHtml) return cachedHtml;
  try {
    const raw = await readFile(TEMPLATE_PATH, "utf-8");
    cachedHtml = raw.replace(/id="version">v\?/g, `id="version">v${pkg.version}`);
    return cachedHtml;
  } catch (err) {
    debug.error("landing: template load failed: %s", err.message);
    return `<!doctype html><meta charset=utf-8><title>CookingFoil</title>
      <h1>CookingFoil</h1><p>landing template missing — try <a href="/shop.json">/shop.json</a>.</p>`;
  }
}

export default async function landingRoute(req, res) {
  const html = await loadTemplate();
  res.type("html").send(html);
}
