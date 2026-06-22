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
RUN pnpm install --frozen-lockfile --prod=false

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

# `corepack prepare` caches pnpm in the image so `pnpm start` does NOT download
# it from the npm registry on every container boot (which was DNS-flaky and
# forced a `sleep` workaround in production).
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate \
    && groupadd -g 10001 medusa \
    && useradd -u 10001 -g medusa -s /usr/sbin/nologin -m medusa \
    && apt-get update && apt-get install -y --no-install-recommends wget tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring in the built app, dependency tree, and runtime scripts.
# `src/` is required at runtime: medusa-config.ts resolves ~67 custom modules
# via `./src/modules/...` paths, so it must be present in the runtime image
# (otherwise module resolution fails and the server had to bind-mount src).
COPY --from=build --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=build --chown=medusa:medusa /app/src ./src
COPY --from=build --chown=medusa:medusa /app/node_modules ./node_modules
COPY --from=build --chown=medusa:medusa /app/restaurant-marketplace ./restaurant-marketplace
COPY --from=build --chown=medusa:medusa /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=medusa:medusa /app/scripts ./scripts
COPY --from=build --chown=medusa:medusa /app/medusa-config.ts ./medusa-config.ts
COPY --from=build --chown=medusa:medusa /app/instrumentation.ts ./instrumentation.ts
COPY --from=build --chown=medusa:medusa /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=medusa:medusa /app/sql ./sql

# Pre-create a `migrations` directory inside every custom module. At runtime the
# non-root `medusa` user runs `medusa db:migrate --execute-safe-links`, which
# attempts to `mkdir` these paths for any module that lacks one; that mkdir
# fails with EACCES, aborting the migrate step so the
# `publishable_api_key_sales_channel` link table is never created and `pnpm
# seed` later dies with TableNotFoundException. Creating the dirs at build time
# (and re-asserting ownership) keeps migrate idempotent and seed-safe.
RUN for d in /app/src/modules/*/; do mkdir -p "$d/migrations"; done \
    && chown -R medusa:medusa /app/src

USER medusa
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]
