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
RUN pnpm install --frozen-lockfile --prod=false

# --- build stage -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js INLINES every NEXT_PUBLIC_* value into the client bundle at build
# time — runtime env (compose `environment:` / .env / k8s secretRef) CANNOT
# override them. So CI must pass the real values as `--build-arg` (see
# .github/workflows/docker-build.yml and docker-compose.yml `build.args`).
# The ARG defaults below are placeholders so a bare `docker build` still works.
ARG NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://backend:9000
ARG NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_local_publishable_key_set_at_build_time
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_DEFAULT_REGION=gb
ARG NEXT_PUBLIC_STRIPE_KEY=pk_test_local_for_build
ARG REVALIDATE_SECRET=build-time-revalidate-secret-min-32-chars-x
ARG NEXT_PUBLIC_SITE_NAME="Black Market Coalition"
ARG NEXT_PUBLIC_SITE_DESCRIPTION="Black Market Coalition"
ARG NEXT_PUBLIC_VENDOR_URL=https://vendor.freeblackmarket.com
ARG NEXT_PUBLIC_ALGOLIA_ID=
ARG NEXT_PUBLIC_ALGOLIA_SEARCH_KEY=
ARG NEXT_PUBLIC_MATRIX_ELEMENT_URL=
ARG NEXT_PUBLIC_MATRIX_SERVER_NAME=
ENV NEXT_PUBLIC_MEDUSA_BACKEND_URL=$NEXT_PUBLIC_MEDUSA_BACKEND_URL \
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_DEFAULT_REGION=$NEXT_PUBLIC_DEFAULT_REGION \
    NEXT_PUBLIC_STRIPE_KEY=$NEXT_PUBLIC_STRIPE_KEY \
    REVALIDATE_SECRET=$REVALIDATE_SECRET \
    NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME \
    NEXT_PUBLIC_SITE_DESCRIPTION=$NEXT_PUBLIC_SITE_DESCRIPTION \
    NEXT_PUBLIC_VENDOR_URL=$NEXT_PUBLIC_VENDOR_URL \
    NEXT_PUBLIC_ALGOLIA_ID=$NEXT_PUBLIC_ALGOLIA_ID \
    NEXT_PUBLIC_ALGOLIA_SEARCH_KEY=$NEXT_PUBLIC_ALGOLIA_SEARCH_KEY \
    NEXT_PUBLIC_MATRIX_ELEMENT_URL=$NEXT_PUBLIC_MATRIX_ELEMENT_URL \
    NEXT_PUBLIC_MATRIX_SERVER_NAME=$NEXT_PUBLIC_MATRIX_SERVER_NAME

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
    # Debian security updates on top of the base tag — see the same note in
    # backend/Dockerfile on why this is applied at our build time.
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    # This image runs `node server.js` (Next.js standalone) and never invokes a
    # package manager, so npm is dead weight — but its bundled dependency tree
    # is most of what a container scan flags here.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=storefront:storefront /app/.next/standalone ./
COPY --from=build --chown=storefront:storefront /app/.next/static ./.next/static
COPY --from=build --chown=storefront:storefront /app/public ./public

USER storefront
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
