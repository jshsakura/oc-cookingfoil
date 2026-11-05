/** The page a browser gets at a locked address, in place of the plain line a console reads. It looks again when the lock ends. */
import { securityText } from "./security-messages.js";

export const lockedPage = (lang, notice, seconds) => `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${Math.max(30, Math.ceil(seconds))}">
<title>CookingFoil</title><style>
:root{--ground:#f2f1ee;--surface:#fff;--ink:#16161a;--secondary:#55555e;--line:#e2e0da;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ground:#16161a;--surface:#1f1f24;--ink:#f2f1ee;--secondary:#a9a8a3;--line:#303037}}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:var(--ground);color:var(--ink);font-family:Inter,"Noto Sans KR",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:400px;box-sizing:border-box;padding:36px 28px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}
h1{margin:0 0 8px;font-size:20px;line-height:1.35}
p{margin:0;color:var(--secondary);font-size:15px;line-height:1.5}
</style><main><h1>${securityText(lang, "lock.title")}</h1><p>${notice}</p></main></html>`;
