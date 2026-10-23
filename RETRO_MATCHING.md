# Korean ROM matching

## Ownership and constraints

Match metadata without renaming, moving, deleting or patching library files. Files on disk are
authoritative. Generated JSON and database records are caches. Never deploy or restart a
container as part of a matching change. Keep arcade ROM filenames as FBNeo short set names;
localized display names belong in `<retro>/arcade-names.json`.

Use an independent branch and worktree from `origin/main` per PR. Use invented ROM names in
tests. Keep personal paths, addresses and credentials out of artifacts. Review once, address
the review once, and gate each push with unit tests and lint in the same command. Set
`COOK_RETRO_AUTO_CORES=false` and `COOK_RETRO_AUTO_ART=false` for tests. Put temporary test data
on disk rather than a RAM-backed temporary directory.

## Current matching paths

- `catalog.js` reads ROM stems, local artwork, `art-map/<system>.json`, `ratings.json` and
  arcade names. Multi-disc entries also consult their first disc's mapping.
- `art/sync.js` matches previously unmapped stems through a known content hash's English name,
  then an exact English title, then an unambiguous subtitle fallback. Existing mappings,
  including explicit nulls, are preserved. The target names both box art and console bezels.
  Arcade art and bezels follow separate set and parent rules.
- `meta/build.js` tries the mapped original title, explicit English name, then filename title
  within the console's LaunchBox platforms. Arcade uses MAME/set names instead. LaunchBox
  records supply descriptions and screenshot URLs; IGDB fills missing metadata.
- `meta/detail.js` and `routes/retro.js` select metadata from a game and its variants for
  details and local screenshots. `themes.js` builds facts from those records; `menu.js`
  selects rows from the facts, without performing title matching itself.
- `achievements/sync.js` uses `meta/build.js` title candidates after RetroAchievements hash
  matching. A title match can show achievements but does not prove that the ROM earns them.

## Failure cases and PR sequence

1. Share lookup title extraction between art and metadata. Previously art selected the first
   ASCII parenthesized group, so an English release's `(USA)` could become its title, and a
   localized stem with multiple or nested groups could select the wrong alias. Cover localized
   aliases, nested groups, release and revision suffixes, ordinary Latin names, metadata and
   achievement candidates with synthetic regression cases. Do not change game IDs, variant
   grouping, SD filenames, explicit mappings or arcade set lookup.
2. Audit live reload separately. The catalog rescans after approximately one minute, while
   some name and metadata stores retain startup state. Metadata-derived menu facts have their
   own memoization. Invalidate dependent caches when authoritative local inputs change and
   verify external edits without restarting. This first PR does not resolve those caches.
3. Add read-only unmatched diagnostics with candidate provenance. Start with names and cheap
   internal identifiers; use existing fingerprints and selective full hashing for unresolved
   files. Keep game identity, Korean support and exact patch version as separate conclusions.

Changing title extraction does not rewrite existing wrong art mappings or force metadata and
achievement refreshes. Those records require an explicit rematch or their normal refresh cycle.
Korean-only names without an alias or a known fingerprint remain unresolved. No filename match
alone establishes patch version or achievement compatibility.
