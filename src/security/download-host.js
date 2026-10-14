/**
 * The download-only address (server-settings downloadBaseUrl).
 *
 * A request whose host is the download address never reaches the rest of the
 * server: it may only GET/HEAD a game file with a valid signed link
 * (download-links.js), and is answered straight from the games folder. Pages,
 * the API, the shop list and sign-in all answer 404 there, so that address can
 * face the internet with nothing on it but the files the lists point to.
 *
 * A link that was signed but has run out answers 403 with
 * X-CookingFoil-Link: expired, so a client knows to read the list again.
 * Requests on any other host pass through untouched.
 */
import express from "express";
import * as links from "./download-links.js";
import { MAX_CONNECTIONS_HEADER } from "../helpers/connection-hint.js";
import { downloadMaxConnections } from "../helpers/envs.js";
import { isGameFile } from "../create-index-content.js";

export const LINK_HEADER = "X-CookingFoil-Link";

function requestHost(req) {
  const forwarded = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  return (forwarded || req.get("host") || "").toLowerCase();
}

export default function downloadHost(root) {
  const serve = express.static(root, { index: false, redirect: false, fallthrough: false });
  return (req, res, next) => {
    const host = links.downloadHost();
    if (!host || requestHost(req) !== host) return next();

    res.set("Cache-Control", "private, no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      return res.status(405).end();
    }
    if (!isGameFile(req.path)) return res.status(404).end();
    const verdict = links.verify(req.path, req.query.exp, req.query.sig);
    if (verdict !== "ok") {
      res.set(LINK_HEADER, verdict === "expired" ? "expired" : "invalid");
      return res.status(403).type("text/plain").send(verdict === "expired" ? "link expired" : "invalid link");
    }
    res.set(MAX_CONNECTIONS_HEADER, String(downloadMaxConnections));
    serve(req, res, (err) => {
      if (res.headersSent) return;
      res.status(err?.status === 404 || err?.statusCode === 404 ? 404 : err?.status || 500).end();
    });
  };
}
