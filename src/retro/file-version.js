/** The ?v= of an image URL: 12 hex of its file's path, size and mtime (and the art pipeline). */
import crypto from "crypto";
import fs from "fs";
import { ART_PIPELINE } from "../meta/artwork-version.js";

/** 12 hex naming one version of a file; null without the file. */
export function fileVersion(file) {
  try {
    const st = fs.statSync(file);
    return crypto.createHash("sha1").update(`${ART_PIPELINE}\0${file}\0${st.size}\0${st.mtimeMs}`).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}
