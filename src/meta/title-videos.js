// Only explicit metadata becomes a trailer. Title names never guess a video.
export function titleVideos(record) {
  const values = [record?.videoUrl, record?.youtube, ...(Array.isArray(record?.videos) ? record.videos : [])];
  const result = [], seen = new Set();
  for (const value of values.slice(0, 10)) {
    const raw = typeof value === "string" ? value : value?.url;
    let id = typeof value === "object" && value?.type === "youtube" ? value.id : null;
    let url;
    try { url = new URL(raw, "https://metadata.invalid"); } catch { /* Missing URLs can still carry a YouTube ID. */ }
    if (!id && url?.protocol === "https:" && !url.username && !url.password) {
      if (url.hostname === "youtu.be") id = url.pathname.slice(1);
      if (["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname))
        id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/embed\//.test(url.pathname) ? url.pathname.slice(7) : null;
    }
    const title = typeof value?.title === "string" ? value.title.slice(0, 128) : "";
    let video;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id)) video = { type: "youtube", id, title };
    else if (typeof raw === "string" && url && !url.username && !url.password &&
      ((raw.startsWith("https://") && url.protocol === "https:") ||
       (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") && url.hostname === "metadata.invalid")) &&
      /\.(mp4|webm)$/i.test(url.pathname)) video = { type: "video", url: raw.startsWith("/") ? raw : url.href, title };
    if (!video) continue;
    const key = video.id || video.url;
    if (!seen.has(key)) { seen.add(key); result.push(video); }
    if (result.length === 8) break;
  }
  return result;
}
