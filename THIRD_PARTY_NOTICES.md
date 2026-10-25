# Third-party notices

CookingFoil is MIT-licensed (see [LICENSE](./LICENSE)) and builds on the work below.

## Origin

- **tinfoil-hat** by Vinicios Clarindo, MIT. CookingFoil started as a fork; the
  original copyright line is kept in `LICENSE`.

## Bundled in the Docker image

The image keeps every license text below in `/usr/share/licenses/cookingfoil/`. The same
files are in [`licenses/`](./licenses) in this repository.

- **nstool** (jakcron/nstool v1.9.2), MIT. Reads NCA/NACP data from game files with
  the user's own keys. License: `licenses/nstool-MIT.txt`.
- **nsz** (nicoboss/nsz), MIT. Decompresses `.nsz` / `.xcz`. License: `licenses/nsz-MIT.txt`.
- **libvips**, LGPL-3.0-or-later, dynamically linked through sharp.
- **hacBrewPack** v3.05 by The-4n, GPL-2.0. A separate program the server runs to pack
  retro games' HOME-menu forwarders with the user's own keys. The original repository is
  gone; the binary is built unmodified from
  [rlaphoenix/hacBrewPack at 745b16e](https://github.com/rlaphoenix/hacBrewPack/tree/745b16ecfc9ce055743067d200572204cb2aac6c).
  The image ships the full source of that commit as `hacBrewPack-source.tar.gz` next to
  `licenses/hacBrewPack-GPL-2.0.txt` and `licenses/hacBrewPack-SOURCE.txt`.
- **nx-hbloader** (switchbrew/nx-hbloader v2.4.5), ISC. The forwarder's exefs
  (`forwarder/exefs/`) is nx-hbloader with `forwarder/hbloader-romfs.patch`, built by
  `forwarder/build.sh` against libnx (ISC). Both notices are reproduced below and in
  `licenses/nx-hbloader-ISC.txt` and `licenses/libnx-ISC.txt`.

## Node.js dependencies (runtime)

| Package | License |
|---|---|
| chokidar, debug, express, express-basic-auth, fast-glob, json5, local-ip-address, multer, otplib, serve-index, uqr, urlencode, ws | MIT |
| dotenv | BSD-2-Clause |
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

- **blawar/titledb**: title names, descriptions and artwork URLs, fetched at run time, not redistributed.
- Artwork, prices and popularity come from public store services at run time and are cached
  locally; they are not part of this repository.
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

## nx-hbloader and libnx

The forwarder exefs in `forwarder/exefs/` contains code from both projects.

nx-hbloader (https://github.com/switchbrew/nx-hbloader), ISC License:

Copyright 2017-2018 nx-hbloader Authors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

libnx (https://github.com/switchbrew/libnx), ISC License:

Copyright 2017-2018 libnx Authors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Lucide

The line icons on the sign-in, device approval and admin pages (`src/views/icons.js`) and the shop's thumbs-up and thumbs-down in its 검수 chip (`src/views/landing.html`) use path data from [Lucide](https://lucide.dev).

ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
