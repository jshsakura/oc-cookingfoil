# Third-party notices

CookingFoil is MIT-licensed (see [LICENSE](./LICENSE)) and builds on the work below.

## Origin

- **tinfoil-hat** by Vinicios Clarindo, MIT. CookingFoil started as a fork; the
  original copyright line is kept in `LICENSE`.

## Bundled in the Docker image

- **nstool** (jakcron/nstool), MIT. Reads NCA/NACP data from game files with
  the user's own keys.
- **nsz** (nicoboss/nsz), MIT. Decompresses `.nsz` / `.xcz`.
- **libvips**, LGPL-3.0-or-later, dynamically linked through sharp.
- **hacBrewPack** (The-4n, built from the rlaphoenix/hacBrewPack mirror at a pinned
  commit), GPL-2.0. A separate program the server runs to pack retro games' HOME-menu
  forwarders with the user's own keys; its source is that repository.
- **nx-hbloader** (switchbrew/nx-hbloader v2.4.5), ISC. The forwarder's exefs
  (`forwarder/exefs/`) is nx-hbloader with `forwarder/hbloader-romfs.patch`, built by
  `forwarder/build.sh` against libnx (ISC).

## Node.js dependencies (runtime)

| Package | License |
|---|---|
| chokidar, debug, express, express-basic-auth, fast-glob, json5, local-ip-address, lodash, multer, otplib, public-ip, serve-index, uqr, urlencode, ws | MIT |
| dotenv | BSD-2-Clause |
| sharp | Apache-2.0 |
| jsqr (served to the browser as `/pair/qr.js`) | Apache-2.0 |

Transitive dependencies are MIT, ISC, BSD or Apache-2.0 (`npx license-checker --production` lists them).

## Fonts and artwork

- **Baloo 2** (EkType), SIL Open Font License 1.1: `src/views/assets/fonts/OFL-Baloo2.txt`, `brand/OFL-Baloo2.txt`.
- **IBM Plex Sans KR** (IBM), SIL Open Font License 1.1: `src/views/assets/fonts/OFL.txt`.
- The butter logo, icon and wordmark in `brand/` are original to this project and MIT-licensed with it.

## Data

- **blawar/titledb**: title names, descriptions and artwork URLs, fetched at run time, not redistributed.
- Artwork, prices and popularity come from public store services at run time and are cached
  locally; they are not part of this repository.

## FinalBurn Neo set list

`src/retro/data/fbneo-arcade.json` keeps the set names, descriptions, parents and BIOS flags from the FinalBurn Neo DAT (https://neo-source.com/, https://github.com/finalburnneo/FBNeo), plus our own Korean, Japanese and Chinese titles. No ROM data is included. Rebuild with `node scripts/fbneo-arcade.mjs`.
