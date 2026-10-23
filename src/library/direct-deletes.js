/**
 * The source files that delete files directly (fs rm/unlink, recursive rmdir, rm run as a program) instead of through the trash
 * (trash-service.js discard), how many such calls each has, and why that is not a person's or the
 * library's file. test/unit/direct-deletes.test.js holds the source to this list.
 *
 * Everything a person or the library owns goes through the trash; only what the server can make
 * again, half-written work, and the trash's own emptying are deleted directly. `todo` marks a file
 * that still deletes something it should not: its count may only fall, and the entry goes once the
 * file uses discard().
 */
export const DIRECT_DELETES = Object.freeze({
  "src/db/backup.js": { count: 4, why: "backup rotation and its work folders" },
  "src/db/database.js": { count: 1, why: "the database's own files" },
  "src/library/safe-move.js": { count: 8, why: "a copy's source after it verified, and half-written copies" },
  "src/library/trash.js": { count: 6, why: "the trash itself: emptying it, and its half-written entries" },
  "src/meta/content-meta.js": { count: 2, why: "legacy files after migrating them, and work files" },
  "src/meta/extract-providers/nsp.js": { count: 2, why: "temporary extraction folders" },
  "src/meta/extract-providers/nsz.js": { count: 1, why: "temporary extraction folders" },
  "src/meta/file-verify.js": { count: 2, why: "temporary files of a check" },
  "src/meta/game-art-files.js": { count: 1, why: "a placed picture once it is the slot's WebP; its shrunk original stays and other candidates move to .replaced" },
  "src/meta/game-descriptions.js": { count: 2, why: "game.json once every description field is empty, and the legacy file after migrating it" },
  "src/meta/game-meta.js": { count: 2, why: "thumbnails and stale temporary files" },
  "src/meta/homebrew-nro-icon.js": { count: 1, why: "a temporary file" },
  "src/meta/homebrew.js": { count: 12, why: "cached GitHub builds and the .nro copies taken out of zips, and temporary files" },
  "src/meta/image-cache.js": { count: 2, why: "the image cache and its old variants" },
  "src/meta/library-organize.js": { count: 1, why: "a move's source after its copy verified" },
  "src/meta/library-upload.js": { count: 3, why: "half-written uploads" },
  "src/meta/nacp-extractor.js": { count: 1, why: "temporary extraction folders" },
  "src/meta/nsz-queue.js": { count: 5, why: "work folders; the original of a verified NSZ conversion (owner's decision: the NSZ is the copy, freeing disk is the point)" },
  "src/meta/patch-info.js": { count: 1, why: "test reset of the store" },
  "src/meta/titledb-download.js": { count: 1, why: "a half-downloaded titledb file" },
  "src/meta/titledb-fetcher.js": { count: 2, why: "a download tombstone and a temporary download" },
  "src/meta/titledb-versions.js": { count: 1, why: "a downloaded titledb file being replaced" },
  "src/retro/art/ratings.js": { count: 1, why: "a downloaded ratings file being replaced" },
  "src/retro/art/sync.js": { count: 1, why: "a picture the server fetched; a person's goes to the trash first" },
  "src/retro/auto-cores.js": { count: 11, why: "cores the server installed, checked by hash; a person's own core goes to the trash" },
  "src/retro/core-files.js": { count: 1, why: "a core's source once it is linked into place" },
  "src/retro/forwarder.js": { count: 2, why: "built forwarders and their work folders" },
  "src/retro/meta/screenshots.js": { count: 1, why: "downloaded screenshots" },
  "src/retro/no-clobber.js": { count: 1, why: "a half-written file" },
  "src/retro/pack-bundle.js": { count: 6, why: "a half-written bundle" },
  "src/retro/pack-fill.js": { count: 11, why: "files this run placed and verified, and its work folders" },
  "src/retro/rom-patch.js": { count: 4, why: "work files, and the backup once it is back over the ROM" },
  "src/retro/square-art.js": { count: 3, why: "derived square art and temporary files" },
  "src/routes/admin/homebrew-upload.js": { count: 1, why: "the waiting copy, after the old file could not go to the trash" },
  "src/routes/admin/retro-patch-api.js": { count: 2, why: "uploaded patch work folders" },
  "src/routes/admin/upload-api.js": { count: 3, why: "upload work folders" },
  "src/routes/client-log.js": { count: 2, why: "log rotation" },
  "src/routes/client-update.js": { count: 1, why: "an empty forwarder" },
  "src/routes/inbox.js": { count: 4, why: "upload work files" },

  "src/meta/art-crop.js": { count: 2, why: "the kept original of an uploaded picture", todo: true },
  "src/meta/art-sidecar.js": { count: 5, why: "a slot's other files and an incoming picture the slot already has; also temporary files", todo: true },
  "src/meta/custom-art.js": { count: 1, why: "a slot's old files once their move to the new slot verified" },
  "src/meta/inbox.js": { count: 4, why: "a drop box entry with its files; also work folders", todo: true },
  "src/meta/item-media.js": { count: 3, why: "a homebrew app's uploaded pictures and its media folder", todo: true },
  "src/routes/uploads.js": { count: 2, why: "an upload not applied yet", todo: true },
  "src/security/prod-keys.js": { count: 3, why: "uploaded prod.keys; also a temporary file", todo: true },
});
