# Third-party notices

CookingFoil is MIT-licensed (see [LICENSE](./LICENSE)) and builds on the work below.

## Bundled in the Docker image

The image keeps every license text below in `/usr/share/licenses/cookingfoil/`. The same
files are in [`licenses/`](./licenses) in this repository.

- **nstool** (jakcron/nstool v1.9.2), MIT. Reads NCA/NACP data from game files with
  the user's own keys. License: `licenses/nstool-MIT.txt`.
- **libchdr** (rtissera/libchdr, built from source at the commit named in the Dockerfile), BSD-3-Clause, with its
  bundled LZMA SDK (public domain), zstd (BSD) and miniz (MIT). Source: https://github.com/rtissera/libchdr.
  A small program of ours, `docker/chdtrack`, uses it to hash the first track of `.chd` disc images in the
  drop box so they can be matched against the Redump list. License: `licenses/libchdr-BSD-3-Clause.txt`.
- **nsz** (nicoboss/nsz), MIT. Decompresses `.nsz` / `.xcz`. License: `licenses/nsz-MIT.txt`.
- **libvips**, LGPL-3.0-or-later, dynamically linked through sharp.

## Node.js dependencies (runtime)

| Package | License |
|---|---|
| chokidar, debug, express, express-basic-auth, fast-glob, json5, multer, otplib, serve-index, uqr, ws | MIT |
| sharp | Apache-2.0 |
| jsqr (served to the browser as `/pair/qr.js`) | Apache-2.0 |
| tabulator-tables (served to the admin page as `/admin/vendor/tabulator.min.*`) | MIT |

Most transitive dependencies are MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0. The
exceptions are the prebuilt `@img/sharp-libvips-*` binaries (LGPL-3.0-or-later, see above) and
`tslib` (0BSD). `npx license-checker --production` lists every package.

## Fonts and artwork

- **Baloo 2** (EkType), SIL Open Font License 1.1: `src/views/assets/fonts/OFL-Baloo2.txt`, `brand/OFL-Baloo2.txt`.
- **IBM Plex Sans KR** (IBM), SIL Open Font License 1.1: `src/views/assets/fonts/OFL.txt`.
- The butter logo, icon and wordmark in `brand/` are original to this project and MIT-licensed with it.

## Data

- **blawar/titledb**: title names, descriptions and version facts, fetched at run time, not redistributed.
- Game icons are read from the user's own game files at run time and cached locally; no artwork
  is fetched from a store, and none is part of this repository.
- **libretro-thumbnails** (box art) and **The Bezel Project** (bezels) are fetched from their
  GitHub repositories at run time and cached in the user's retro folder. The images belong
  to their owners and are not redistributed here.
- **LaunchBox Games Database** (game details, screenshots, ratings), **IGDB** (details and
  scores, with the user's own Twitch application keys) and **Steam** review scores are read
  at run time; nothing from them is included in this repository.

## FinalBurn Neo set list

`src/retro/data/fbneo-arcade.json` keeps the set names, descriptions, parents and BIOS flags from the FinalBurn Neo DAT (https://neo-source.com/, https://github.com/finalburnneo/FBNeo), plus our own Korean, Japanese and Chinese titles. No ROM data is included. Rebuild with `node scripts/fbneo-arcade.mjs`.

This file is **not** covered by CookingFoil's MIT license. It is derived from FinalBurn Neo
and is distributed under the FinalBurn Neo license, which forbids selling it or seeking
monetary profit or donations for a project that uses it. The full text is in
[`licenses/FBNeo-LICENSE.txt`](./licenses/FBNeo-LICENSE.txt), copied verbatim from
`src/license.txt` of finalburnneo/FBNeo at commit 66adff7.
