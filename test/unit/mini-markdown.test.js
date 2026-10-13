import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../../src/helpers/mini-markdown.js";

test("the guide's markdown becomes headings, lists, tables and code", () => {
  const html = renderMarkdown("# 제목\n\n본문 **굵게** 와 `코드`, https://example.com 링크.\n\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n| 일 | 요청 |\n|---|---|\n| 키 | `POST …/<igdb\\|github>` |\n\n```sh\ncurl $BASE\n```");
  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<p>본문 <strong>굵게<\/strong> 와 <code>코드<\/code>, <a href="https:\/\/example.com"[^>]*>https:\/\/example.com<\/a> 링크.<\/p>/);
  assert.match(html, /<ul><li>하나<\/li><li>둘<\/li><\/ul>/);
  assert.match(html, /<ol><li>첫째<\/li><li>둘째<\/li><\/ol>/);
  assert.match(html, /<th>일<\/th><th>요청<\/th>/);
  assert.match(html, /<td><code>POST …\/&lt;igdb\|github&gt;<\/code><\/td>/, "an escaped pipe stays inside its cell");
  assert.match(html, /<pre><code>curl \$BASE<\/code><\/pre>/);
});

test("text can never inject markup", () => {
  const html = renderMarkdown("<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n`<b>`");
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;/);
});
