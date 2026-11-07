/**
 * One zip of what file-roots collect() listed, stored as is (games do not shrink), with its length known so the
 * browser shows progress. A download stopped halfway closes the file being read.
 */
import fs from "fs";
import yazl from "yazl";
import debug from "../debug.js";

export function sendZip(res, entries, name) {
  const zip = new yazl.ZipFile();
  let reading = null;
  for (const e of entries) {
    if (e.dir) zip.addEmptyDirectory(e.name, { mtime: e.mtime });
    else zip.addReadStreamLazy(e.name, { size: e.size, mtime: e.mtime, compress: false }, (cb) => cb(null, (reading = fs.createReadStream(e.real))));
  }
  // Every size is known, so yazl answers the zip's length at once, before a byte is sent.
  zip.end((total) => {
    if (total >= 0) res.set("Content-Length", String(total));
  });
  // A file that changed or went away since the list cut the zip short; the browser then calls the download failed.
  zip.on("error", (err) => {
    debug.error("files: zip: %s", err.message);
    res.destroy(err);
  });
  res.on("close", () => {
    if (res.writableFinished) return;
    zip.outputStream.unpipe(res);
    zip.outputStream.destroy();
    reading?.destroy();
  });
  res.attachment(name);
  res.type("application/zip");
  zip.outputStream.pipe(res);
}
