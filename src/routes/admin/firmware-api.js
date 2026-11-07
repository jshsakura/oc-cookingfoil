/**
 * The settings tab's firmware row (server-settings-panel.js) and the firmware capability:
 *
 *   GET  /admin/api/firmware          the follower's status (firmware/service.js status()):
 *                                     { source, enabled, hours, reachable, checked_at, error, next_check, checking, versions: [...] }
 *   POST /admin/api/firmware/refresh  reads the release list again now, in the background;
 *                                     { started, ...status }. 409 { error } while no source is set
 *
 * The source and interval are the firmwareRepo and firmwareHours server settings. The server keeps no zip.
 */
import { firmware } from "../firmware.js";

export function mountFirmwareApi(router, requireSession) {
  router.get("/api/firmware", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").json(firmware.status());
  });
  router.post("/api/firmware/refresh", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (!firmware.enabled()) return res.status(409).json({ error: "no firmware source is set" });
    const started = firmware.refreshNow();
    res.status(202).json({ started, ...firmware.status() });
  });
}
