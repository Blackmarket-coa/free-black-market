# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Backend (MedusaJS 2) production image — multi-stage, non-root runtime.
# `restaurant-marketplace` is a local file: dependency referenced in
# package.json; it must be COPY-ed before `pnpm install` so the lockfile
# resolves cleanly.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=20-bookworm-slim

# --- deps stage --------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY restaurant-marketplace ./restaurant-marketplace
RUN --mount=type=cache,id=pnpm-store-backend,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# --- build stage -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/restaurant-marketplace ./restaurant-marketplace
COPY . .

RUN rm -rf .medusa && pnpm build

# --- runtime stage -----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9000

RUN corepack enable \
    && groupadd -g 10001 medusa \
    && useradd -u 10001 -g medusa -s /usr/sbin/nologin -m medusa \
    && apt-get update && apt-get install -y --no-install-recommends wget tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring in the built app, dependency tree, and runtime scripts.
COPY --from=build --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=build --chown=medusa:medusa /app/node_modules ./node_modules
COPY --from=build --chown=medusa:medusa /app/restaurant-marketplace ./restaurant-marketplace
COPY --from=build --chown=medusa:medusa /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=medusa:medusa /app/scripts ./scripts
COPY --from=build --chown=medusa:medusa /app/medusa-config.ts ./medusa-config.ts
COPY --from=build --chown=medusa:medusa /app/instrumentation.ts ./instrumentation.ts
COPY --from=build --chown=medusa:medusa /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=medusa:medusa /app/sql ./sql

USER medusa
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]
