# AGENTS.md

Notes for coding agents working in this repository. People should start with CONTRIBUTING.md.

CookingFoil is a self-hosted Switch and retro library server (Node ESM, Express). Routes live in
`src/routes/`, the admin API in `src/routes/admin/`, and the logic they call in modules under `src/`.

## Checks

```bash
npm run test:unit   # node --test test/unit/*.test.js
npm run lint        # eslint: undefined and unused symbols
npm run test:web    # Playwright; run `npx playwright install chromium` once
```

Gate every push on the checks in the same command, and never push a red suite:

```bash
npm run test:unit && npm run lint && git push
```

Branch from `origin/main` for each change. Do not push to `main`.

## Every feature has a capability

A capability describes one thing an agent can do: id, English description, input schema, safety
(`read`, `write`, `destructive`) and whether an automation token may use it. MCP tools and API docs
are built from it.

- Write it with `defineCapability()` (`src/capabilities/define.js`) in `src/capabilities/<area>.js`
  and add it to `src/capabilities/registry.js`.
- A new route needs a capability whose `http` names it, or an entry in `OPT_OUT`
  (`src/capabilities/opt-out.js`) with a reason. `test/unit/capability-coverage.test.js` fails
  otherwise and says which file to edit.
- `LEGACY_UNREGISTERED` only shrinks. When a capability claims a legacy route, delete that line and
  lower `LEGACY_CEILING` in the coverage test. Never add to it: a diff that grows the list or raises
  `LEGACY_CEILING` is refused in review.
- Register routes unconditionally, inside the router factory, and check whether a feature is on
  when a request comes in. The coverage test starts the real app and reads its router, so a route
  added only when an environment variable is set, or a middleware that answers a path itself, is
  not seen.
- Token reach comes from `TOKEN_PATHS`, `TOKEN_BLOCKED_RE` and `TOKEN_LOCKED`. Do not copy those lists.
- Handlers call module functions, never the HTTP route.

## The library is hands off

Never move, rename or delete files in the game library (`games/`, `retro/`, roms) without the
user's agreement for that run. Only `games/incoming` sorts itself. Files on disk are the truth; the
server's lists are a cache.

## No personal data

No real IP addresses, host names, e-mail addresses, keys, tokens or home paths in code, tests,
fixtures, comments, commits or pull requests. Use `example.com` / `example.org` and the
documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`. Make fake keys look
fake (`"a".repeat(64)`).

## Style

- Text agents read (capabilities, API docs, this file) is English. Admin page strings ship in
  `en`, `ko`, `ja` and `zh` together; Korean uses 합니다체.
- New UI text goes into a dictionary in all its languages (`ko en ja zh` for admin and web pages, the
  twelve client languages for text a console shows); `test/unit/i18n-ratchet.test.js` enforces it.
- No em dashes or en dashes joining sentences.
- Settings are changed on the admin page and apply without a restart; environment variables only
  seed them.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `test:`, ...).
