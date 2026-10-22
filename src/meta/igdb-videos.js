/**
 * Game trailers from IGDB: the YouTube videos a game's entry lists, asked for
 * in the same query that already finds the game (rating-sync.js for Switch
 * games, retro/meta/igdb.js for retro ones), never in a request of their own.
 * Only the web's admin view shows them (routes/videos.js); consoles never get them.
 *
 *   videos = [{ id: YouTube video id, name }]   IGDB's order, at most MAX_VIDEOS
 */
export const VIDEO_FIELDS = "videos.video_id,videos.name";
export const MAX_VIDEOS = 8;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_NAME = 128;

/**
 * IGDB's `videos` ({ video_id, name }) or stored ones ({ id, name }) as
 * [{ id, name }]: YouTube ids only, no repeats, at most MAX_VIDEOS; null without any. Pure.
 */
export function videosOf(list) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    const id = v?.video_id ?? v?.id;
    if (typeof id !== "string" || !YOUTUBE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: typeof v.name === "string" ? v.name.trim().slice(0, MAX_NAME) : "" });
    if (out.length === MAX_VIDEOS) break;
  }
  return out.length ? out : null;
}
