import { test } from "node:test";
import assert from "node:assert/strict";
import { titleVideos } from "../../src/meta/title-videos.js";
test("explicit trailers accept safe YouTube IDs and video URLs without guessing", () => {
  assert.deepEqual(titleVideos({ name: "A game" }), []);
  assert.deepEqual(titleVideos({ videos: ["https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk", { type: "youtube", id: "ABCDEFGHIJK", title: "Trailer" }, "/preview/trailer.mp4"] }), [
    { type: "youtube", id: "abcdefghijk", title: "" },
    { type: "youtube", id: "ABCDEFGHIJK", title: "Trailer" },
    { type: "video", url: "/preview/trailer.mp4", title: "" },
  ]);
  for (const url of ["javascript:alert(1)", "//evil/film.mp4", "https://user:secret@cdn/film.mp4", "https://youtube.com.evil/watch?v=abcdefghijk", "https://youtu.be/invalid", "http://cdn/film.mp4", "/\\evil/film.mp4", "https://cdn/film.html"])
    assert.deepEqual(titleVideos({ videos: [url] }), [], url);
});
