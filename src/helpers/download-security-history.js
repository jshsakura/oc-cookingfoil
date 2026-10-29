/** Host firewall alerts, published atomically by the optional edge monitor.
 * Kept separate from Telegram history so an unavailable bot cannot hide a ban.
 * Only a local file is trusted; no HTTP request can submit an operator alert.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./envs.js";
import { translator } from "./alert-messages.js";

export const DOWNLOAD_SECURITY_FILE = path.join(dataDir, "security", "download-security.json");
const ACTIONS = new Set(["blocked", "released", "expired", "detected"]);

export function downloadSecurityHistory(lang, file = DOWNLOAD_SECURITY_FILE) {
  try {
    if (fs.statSync(file).size > 1_000_000) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data.events)) return [];
    const t = translator(lang);
    return data.events.slice(-100).filter((e) => Number.isFinite(e.at) && ACTIONS.has(e.action) && typeof e.reason === "string")
      .map((e) => {
        const people = (Array.isArray(e.users) ? e.users : []).slice(0, 10).map((u) => {
          const who = [u.owner, u.label, u.device].filter((v) => typeof v === "string" && v).join(" / ");
          return u.match === "request" ? who : `${who} (${t("edgeAddressCandidate")})`;
        }).filter(Boolean).join(", ") || t("edgeUnknown");
        const until = Number.isFinite(e.until) ? new Date(e.until).toISOString() : t("edgeNoExpiry");
        return {
          at: Number.isFinite(e.updatedAt) ? e.updatedAt : e.at,
          event: "security",
          text: t("edgeSummary", { action: t(`edge.${e.action}`), who: people, reason: e.reason, until, count: Number(e.count) || 0 }),
          status: e.delivery === "sent" ? "sent" : e.delivery === "failed" ? "failed" : "off",
        };
      });
  } catch { return []; }
}
