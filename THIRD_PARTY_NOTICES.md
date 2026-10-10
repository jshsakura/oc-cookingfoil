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

## Node.js dependencies (runtime)

| Package | License |
|---|---|
| chokidar, debug, express, express-basic-auth, fast-glob, json5, local-ip-address, lodash, multer, otplib, public-ip, serve-index, urlencode, ws | MIT |
| dotenv | BSD-2-Clause |
| sharp | Apache-2.0 |

Transitive dependencies are MIT, ISC, BSD or Apache-2.0 (`npx license-checker --production` lists them).

## Fonts and artwork

- **Baloo 2** (EkType), SIL Open Font License 1.1: `src/views/assets/fonts/OFL-Baloo2.txt`, `brand/OFL-Baloo2.txt`.
- **IBM Plex Sans KR** (IBM), SIL Open Font License 1.1: `src/views/assets/fonts/OFL.txt`.
- The butter logo, icon and wordmark in `brand/` are original to this project and MIT-licensed with it.

## Data

- **blawar/titledb**: game names, descriptions and artwork URLs, fetched at run time, not redistributed.
- Artwork, prices and popularity come from Nintendo's public eShop services at run time and are cached
  locally; they are not part of this repository.
