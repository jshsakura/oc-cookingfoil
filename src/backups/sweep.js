// The hourly tidy of consoles' backups: uploads left a day go, removed versions past their month go, and then
// the bodies nothing refers to.
import path from "node:path";
import * as store from "./store.js";
import { sweepUploads } from "./uploads.js";
import debug from "../debug.js";

export async function sweepBackups(now = Date.now()) {
  const root = store.backupsRoot();
  if (!root) return;
  for (const folder of await store.accountFolders()) {
    await sweepUploads(path.join(root, folder), now);
    const { count, bytes } = await store.sweepFolder(folder, now);
    if (count) debug.log("backups: swept %d unused files (%d bytes)", count, bytes);
  }
}
