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
    DEBUG=oc-cookingfoil*

WORKDIR /app

# Pre-create the bind-mount targets so the user doesn't have to.
# Runs as root (USER directive intentionally omitted): the legacy
# vinicioslc/tinfoil-hat image ran as root too, so drop-in swaps don't
# trip over host UID mismatches on bind-mounted /games. Users who want
# non-root should set `user: "1000:1000"` (or their host uid:gid) in
# their docker-compose.yml.
RUN mkdir -p /games /data /keys

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Ship the shop template at the legacy tinfoil-hat mount point so users
# can swap `vinicioslc/tinfoil-hat` for `oc-cookingfoil` without touching
# their existing docker-compose volume mappings.
COPY shop_template.jsonc /shop_template.jsonc

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${COOK_PORT}/shop.json" >/dev/null || exit 1

CMD ["node", "src/index.js"]
