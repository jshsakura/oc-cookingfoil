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
    DEBUG=oc-cookingfoil*

WORKDIR /app

# non-root runtime user, owns /games
RUN addgroup -S cook && adduser -S -G cook cook && \
    mkdir -p /games && chown -R cook:cook /games

COPY --from=deps --chown=cook:cook /app/node_modules ./node_modules
COPY --chown=cook:cook package.json shop_template.jsonc ./
COPY --chown=cook:cook src ./src

USER cook

EXPOSE 80

# wget is included in node:alpine. Healthcheck hits the dynamic shop endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${COOK_PORT}/shop.json" >/dev/null || exit 1

CMD ["node", "src/index.js"]
