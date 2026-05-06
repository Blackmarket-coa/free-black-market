# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Storefront (Next.js 15) production image — multi-stage, distroless-style runtime.
# Uses Next.js `output: 'standalone'` so the runtime layer ships only the
# minimal node_modules subset Next collected during build.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=20-bookworm-slim

# --- deps stage --------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=storefront-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# --- build stage -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders: `pnpm run build` calls
# `await-backend` + `launch-storefront build`, which polls
# http://localhost:9000 for a publishable key. There's no backend during a
# Docker build, so we invoke `next build` directly with placeholder
# `NEXT_PUBLIC_*` values. The actual values are injected at run-time via
# the Deployment's secretRef envFrom (`storefront-env`).
ENV NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://backend:9000
ENV NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_local_publishable_key_set_at_runtime
ENV NEXT_PUBLIC_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_DEFAULT_REGION=us
ENV NEXT_PUBLIC_STRIPE_KEY=pk_test_local_for_build
ENV REVALIDATE_SECRET=build-time-revalidate-secret-min-32-chars-x

RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN node_modules/.bin/next build

# --- runtime stage -----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd -g 10001 storefront && useradd -u 10001 -g storefront -s /usr/sbin/nologin -m storefront \
    && apt-get update && apt-get install -y --no-install-recommends wget tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=storefront:storefront /app/.next/standalone ./
COPY --from=build --chown=storefront:storefront /app/.next/static ./.next/static
COPY --from=build --chown=storefront:storefront /app/public ./public

USER storefront
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
