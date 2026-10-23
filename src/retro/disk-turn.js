/**
 * One reader of the ROM files at a time: the RetroAchievements hashes
 * (rom-hash.js) and the content hash index (rom-index.js) each read every new
 * ROM after a scan, and two passes at once would make the disk seek between them.
 */
let last = Promise.resolve();

/** Runs `fn` once every pass handed in before it has ended; resolves or rejects as `fn` does. */
export function inTurn(fn) {
  const run = last.then(fn);
  last = run.catch(() => {});
  return run;
}
