# syntax=docker/dockerfile:1.7
# CookingFoil — local Switch homebrew shop server.

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
      org.opencontainers.image.description="Local Switch homebrew shop server (CookingFoil)" \
      org.opencontainers.image.source="https://github.com/jshsakura/oc-cookingfoil" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    COOK_PORT=80 \
    COOK_GAMES_DIR=/games \
    COOK_DATA_DIR=/data \
    COOK_KEYS_DIR=/keys \
    COOK_SHOP_TEMPLATE=/shop_template.jsonc \
    COOK_NSTOOL_BIN=/usr/local/bin/nstool \
    COOK_NSZ_BIN=/usr/bin/nsz \
    # Info + errors by default; bump to `oc-cookingfoil*` for full traces
    # (incl. per-icon cache I/O during prewarm — chatty on big libraries).
    DEBUG=oc-cookingfoil,oc-cookingfoil:err

WORKDIR /app

# Pre-create the bind-mount targets so the user doesn't have to.
# Runs as root (USER directive intentionally omitted): the legacy
# vinicioslc/tinfoil-hat image ran as root too, so drop-in swaps don't
# trip over host UID mismatches on bind-mounted /games. Users who want
# non-root should set `user: "1000:1000"` (or their host uid:gid) in
# their docker-compose.yml.
RUN mkdir -p /games /data /keys

# nstool — copied from the builder stage. Single static binary, ~1-2 MB.
COPY --from=nstool-builder /nstool /usr/local/bin/nstool

# nsz — decompresses .nsz / .xcz wrappers into .nsp / .xci so the NSP
# extractor can run against the inner container. Pure Python (uses the
# zstandard library), installed via pip. --break-system-packages is
# required on Alpine 3.20+'s PEP 668 environment; the image is single-
# tenant and we own the Python install, so this is safe.
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages nsz && \
    # Drop pip caches & build deps to keep the runtime layer lean.
    rm -rf /root/.cache /tmp/* /var/cache/apk/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Ship the shop template at the legacy tinfoil-hat mount point so users
# can swap `vinicioslc/tinfoil-hat` for `oc-cookingfoil` without touching
# their existing docker-compose volume mappings.
COPY shop_template.jsonc /shop_template.jsonc

EXPOSE 80

# /healthz alone only proves the process is alive: it sits in front of the
# guards, so in v0.8.2 it answered 200 for an hour while every real request
# 500'd and the container sat there reporting "healthy". Probe the guarded root
# too and treat 5xx as unhealthy — 401/403 are correct answers, not failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const b='http://127.0.0.1:'+(process.env.COOK_PORT||80);(async()=>{const h=await fetch(b+'/healthz');if(!h.ok)process.exit(1);const r=await fetch(b+'/',{redirect:'manual'});if(r.status>=500)process.exit(1)})().catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
