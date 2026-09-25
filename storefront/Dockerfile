# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Storefront (Next.js 15) production image — multi-stage, distroless-style runtime.
# Uses Next.js `output: 'standalone'` so the runtime layer ships only the
# minimal node_modules subset Next collected during build.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=22-bookworm-slim

# --- deps stage --------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN corepack enable

# `pnpm-workspace.yaml` carries the dependency overrides, which pnpm 11 no
# longer reads from package.json. Omitting it here does not fail the build —
# it silently resolves the unpinned versions, which is how a CVE fix gets
# undone inside an image while every gate stays green.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `--trust-lockfile` skips pnpm 11's per-entry supply-chain verification, which
# contacts the registry once for every lockfile entry. Backend has ~1750, and
# four images build in parallel, so this step rate-limited npm and failed the
# build outright:
#
#   x Lockfile failed supply-chain policy check (1752 entries in 2m 34.3s)
#   [ERR_PNPM_FETCH_429] GET .../@medusajs%2Fmodules-sdk: Too Many Requests
#
# An image build is the wrong place to verify anyway: it consumes a lockfile
# that is already committed and reviewed. `security.yml`'s install is the
# designated verifier and deliberately omits this flag.
RUN pnpm install --frozen-lockfile --prod=false --trust-lockfile

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
# Phase-1 feature flags (src/lib/feature-flags.ts). Only the literal "true"
# enables one, so the empty defaults keep every flag off.
ARG NEXT_PUBLIC_FF_POS_V1=
ARG NEXT_PUBLIC_FF_WEIGHT_PRICING_V1=
ARG NEXT_PUBLIC_FF_PICK_PACK_V1=
ARG NEXT_PUBLIC_FF_INVOICING_V1=
ARG NEXT_PUBLIC_FF_CHANNEL_SYNC_V1=
ARG NEXT_PUBLIC_FF_INVESTMENT_POOLS_V1=
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
    NEXT_PUBLIC_MATRIX_SERVER_NAME=$NEXT_PUBLIC_MATRIX_SERVER_NAME \
    NEXT_PUBLIC_FF_POS_V1=$NEXT_PUBLIC_FF_POS_V1 \
    NEXT_PUBLIC_FF_WEIGHT_PRICING_V1=$NEXT_PUBLIC_FF_WEIGHT_PRICING_V1 \
    NEXT_PUBLIC_FF_PICK_PACK_V1=$NEXT_PUBLIC_FF_PICK_PACK_V1 \
    NEXT_PUBLIC_FF_INVOICING_V1=$NEXT_PUBLIC_FF_INVOICING_V1 \
    NEXT_PUBLIC_FF_CHANNEL_SYNC_V1=$NEXT_PUBLIC_FF_CHANNEL_SYNC_V1 \
    NEXT_PUBLIC_FF_INVESTMENT_POOLS_V1=$NEXT_PUBLIC_FF_INVESTMENT_POOLS_V1

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

# Cache-bust the security-update layer below.
#
# That `apt-get upgrade` is meant to pick up fixes published after the base tag
# was built, and the comment below says so. It did not: `docker-build.yml`
# builds with `cache-from/to: type=gha,mode=max`, so this layer is restored
# from cache on every build and the upgrade runs **once**, when the layer is
# first created, and never again. The image therefore keeps whatever package
# versions existed that day, permanently.
#
# That is not hypothetical. On 2026-09-14 the backend and storefront image
# scans went red on `libpcre2-8-0` 10.42-1 (CVE-2026-86145 out-of-bounds
# write, CVE-2026-89161 memory corruption in `pcre2_jit_match`, both HIGH),
# while `10.42-1+deb12u1` was already sitting in bookworm-security — checked
# against the mirror's own Packages index, not inferred. The upgrade step was
# right there in this file and could not run.
#
# CI passes a date, so the layer rebuilds once a day and the rest of the
# cache is untouched: the expensive dependency and build stages above are
# unaffected. Referenced inside the RUN because BuildKit only invalidates on
# an ARG that is actually used.
ARG SECURITY_REFRESH=unset
RUN echo "security-refresh=${SECURITY_REFRESH}" >/dev/null \
    && groupadd -g 10001 storefront && useradd -u 10001 -g storefront -s /usr/sbin/nologin -m storefront \
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

# Commit this image was built from, reported as `commit` by GET /api/health
# (read at request time — that route is dynamic, so it is not baked in by
# `next build`). CI passes `github.sha`. Declared after the last RUN on
# purpose: a build-arg that changes every commit invalidates every RUN below
# its ARG, and there are none below this one. Empty by default, not "unknown",
# so the route's RAILWAY_GIT_COMMIT_SHA fallback still applies when unset.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA

USER storefront
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
