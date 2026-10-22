/**
 * How many consoles are downloading the RetroArch pack (the whole-pack tar or one of its files) right now.
 * The pack's own upkeep (pack-watch.js) waits while it is above zero, so a file is not swapped under a
 * download that has already listed it.
 */
let active = 0;

/** Counts one download; call the returned function when it is over (calling it twice counts once). */
export function begin() {
  active++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active--;
  };
}

export const busy = () => active > 0;
