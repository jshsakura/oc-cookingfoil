# syntax=docker/dockerfile:1.7
# CookingFoil: a personal, self-hosted homebrew file server.

# ---- deps: install production dependencies only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts prevents playwright (devDependency) lifecycle hooks
# from pulling browsers during production install.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# ---- nstool: build jakcron/nstool from source ----
# Used by the NSP/XCI keyed extractor to dump container contents so we
# can read the Control NCA's NACP + icon. Building from source keeps us
# arch-portable through buildx's QEMU emulation — the same Dockerfile
# produces a working binary for both linux/amd64 and linux/arm64.
#
# Two-step build per upstream BUILDING.md: make deps (builds the bundled
# libpietendo / libtoolchain / libfmt / liblz4 / libmbedtls submodules),
# then make (compiles nstool linking against those). Output lands at
# bin/nstool.
FROM alpine:3.20 AS nstool-builder
RUN apk add --no-cache git build-base linux-headers
WORKDIR /build
ARG NSTOOL_REF=v1.9.2
RUN git clone --depth 1 --branch "${NSTOOL_REF}" --recurse-submodules \
        https://github.com/jakcron/nstool.git
WORKDIR /build/nstool
RUN make -j"$(nproc)" deps && \
    make -j"$(nproc)" && \
    cp bin/nstool /nstool && \
    strip /nstool

# ---- runtime ----
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="CookingFoil" \
      org.opencontainers.image.description="Personal, self-hosted homebrew file server (CookingFoil)" \
      org.opencontainers.image.source="https://github.com/jshsakura/oc-cookingfoil" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=16 \
    COOK_PORT=80 \
    # One storage folder holds every other folder (src/helpers/storage-layout.js).
    # A server that still mounts /games, /data, /keys, ... separately keeps them.
    COOK_STORAGE_DIR=/storage \
    COOK_NSTOOL_BIN=/usr/local/bin/nstool \
    COOK_NSZ_BIN=/usr/bin/nsz \
    # Info + errors by default; bump to `oc-cookingfoil*` for full traces
    # (incl. per-icon cache I/O during prewarm — chatty on big libraries).
    DEBUG=oc-cookingfoil,oc-cookingfoil:err

WORKDIR /app

# No folder is made here: /storage (or an older /games, /data, ...) counts only
# when it is mounted. The container starts as root to make the storage folder's
# role folders and hand them to PUID:PGID (docker/entrypoint.sh), then runs the
# server as that user.

# nstool — copied from the builder stage. Single static binary, ~1-2 MB.
COPY --from=nstool-builder /nstool /usr/local/bin/nstool

# License texts for this project and every bundled binary.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/cookingfoil/
COPY licenses/ /usr/share/licenses/cookingfoil/

# nsz — decompresses .nsz / .xcz wrappers into .nsp / .xci so the NSP
# extractor can run against the inner container. Pure Python (uses the
# zstandard library), installed via pip. --break-system-packages is
# required on Alpine 3.20+'s PEP 668 environment; the image is single-
# tenant and we own the Python install, so this is safe.
# unzip opens the patch and save zips uploaded from the admin page.
# 7zip unpacks the official RetroArch bundle (.7z) that the retro tab fills the pack from.
# su-exec drops from root to PUID:PGID in the entrypoint.
# xdelta3 applies the xdelta (VCDIFF) patches the admin puts on a retro ROM.
RUN apk add --no-cache python3 py3-pip unzip su-exec 7zip xdelta3 && \
    pip3 install --no-cache-dir --break-system-packages nsz && \
    # Drop pip caches & build deps to keep the runtime layer lean.
    rm -rf /root/.cache /tmp/* /var/cache/apk/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY i18n ./i18n
# Box art and bezel fetchers, run for a console after a retro ROM is uploaded.
COPY scripts/retro-art.mjs scripts/retro-art-match.mjs scripts/retro-ratings.mjs ./scripts/
COPY docker/entrypoint.sh /usr/local/bin/cookingfoil-entrypoint

EXPOSE 80

# /healthz alone only proves the process is alive: it sits in front of the
# guards, so in v0.8.2 it answered 200 for an hour while every real request
# 500'd and the container sat there reporting "healthy". Probe the guarded root
# too and treat 5xx as unhealthy — 401/403 are correct answers, not failures.
# While a safe restart drains, / answers 503 on purpose, so that probe is skipped.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const b='http://127.0.0.1:'+(process.env.COOK_PORT||80);(async()=>{const h=await fetch(b+'/healthz');if(!h.ok)process.exit(1);if((await h.json()).draining)return;const r=await fetch(b+'/',{redirect:'manual'});if(r.status>=500)process.exit(1)})().catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/cookingfoil-entrypoint"]
# node:sqlite still prints an ExperimentalWarning on every start; it is stable enough here.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
