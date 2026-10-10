# Contributing

Thanks for helping. A few things keep the project working for everyone.

## Ground rules

- **CyberFoil and Tinfoil compatibility comes first.** `shop.tfl`, `shop.json`
  and `/api/shop/sections` are used by clients we do not control. Add fields;
  do not rename or remove them. New optional behaviour gets a name in the
  `features` list of `/api/shop/info`.
- **Language-dependent data uses English keys** (genres, review labels) with
  labels for every supported language (`en`, `ko`, `ja`, `zh`), never one fixed
  display language.
- **No game content, keys or Nintendo assets** in the repository, tests or
  issues. Test fixtures use fake homebrew title ids (`05000000…`).

## Workflow

1. Fork, then branch from `main`.
2. `npm install`, optionally `npm run hooks:install` for the pre-commit checks.
3. Make the change with tests: `test/unit` (node:test) for logic,
   `test/web` (Playwright) for the dashboard and admin page.
4. `npm run lint && npm run test:unit` must pass; CI also runs `npm run test:web`.
5. Open a pull request describing what changed and how you tested it.

Commit messages follow `type: summary` (`feat`, `fix`, `docs`, `test`, `chore`, …).

## Where things are

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for how a request becomes a
shop response and where metadata comes from.
