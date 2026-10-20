/**
 * Item settings changed from an admin device: a console the admin allowed on the
 * devices tab (security/device-admin.js; shop info then lists "admin-edit").
 * Any other caller, a browser included, gets 403 { error: "admin device only" }.
 * The dashboard changes the same settings through meta/item-fields.js, so the
 * console and the web never disagree; every change is kept in admin-edits.jsonl.
 *
 *   GET   /api/admin/items/:kind/:id/fields                  { fields: [F…] }
 *   PATCH /api/admin/items/:kind/:id/fields  { key, value }   { fields: [F…] } after the change
 *
 * kind  homebrew (id "m-…" | "gh-…"), retro (a retro game id), game (a base title id, 16 hex)
 * F     { key, type: "toggle", label: { ko, en, ja, zh }, value: true }
 *     | { key, type: "choice", label: { ko, en, ja, zh }, value: "tool",
 *         options: [{ value: "tool", label: { ko, en, ja, zh } }, …] }
 *
 * Fields: homebrew verified, enabled, kind ("tool" | "port"), cores ("3" | "4",
 * not on an installable title); retro and game verified.
 *
 *   PATCH /api/admin/items/homebrew/m-0123456789ab/fields  {"key":"verified","value":true}
 *   → 200 {"fields":[{"key":"verified","type":"toggle","label":{"ko":"검수됨",…},"value":true}, …]}
 *
 * Errors, as { error }: 404 unknown kind or item, 400 unknown key or a value of
 * the wrong type or not among the options.
 */
import express from "express";
import { adminDeviceOf } from "../security/device-admin.js";
import * as store from "../security/store.js";
import { listFields, setField, FieldError } from "../meta/item-fields.js";
import debug from "../debug.js";

export default function adminItemsRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "4kb" }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!adminDeviceOf(req)) return res.status(403).json({ error: "admin device only" });
    next();
  });

  const handle = (fn) => async (req, res, next) => {
    try {
      res.json({ fields: await fn(req) });
    } catch (err) {
      if (err instanceof FieldError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };

  router.get("/:kind/:id/fields", handle((req) => listFields(req.params.kind, req.params.id)));

  router.patch("/:kind/:id/fields", handle(async (req) => {
    const device = adminDeviceOf(req);
    const deviceName = store.devicesSnapshot().approved.find((d) => d.deviceKey === device)?.label || null;
    const { kind, id } = req.params;
    const fields = await setField(kind, id, req.body?.key, req.body?.value, { via: "device", device, deviceName });
    debug.log("admin device %s… set %s %s %s", device.slice(0, 12), kind, id, req.body?.key);
    return fields;
  }));

  return router;
}
