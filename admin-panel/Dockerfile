# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Admin panel (Vite + React) production image.
# Build artefact is a static bundle served by nginx-alpine.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=22-bookworm-slim
ARG NGINX_VERSION=1.31-alpine

# --- build stage -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=production

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
# pnpm 11 re-verifies node_modules against the lockfile before running any
# script, by spawning its own pnpm — which does not inherit the
# `--trust-lockfile` on the install above, so it would re-run the full
# supply-chain pass (one registry request per lockfile entry) on every
# `pnpm run` in this build.
ENV pnpm_config_verify_deps_before_run=false
RUN pnpm install --frozen-lockfile --prod=false --trust-lockfile

COPY . .

# Vite inlines VITE_* values into the static bundle at build time (loadEnv reads
# them from the build environment), so the backend URL MUST be present here — a
# runtime env_file cannot change an already-built SPA. The ARG defaults keep a
# bare `docker build` working; CI/production overrides them via build-args (see
# .github/workflows/docker-build.yml). Without these the bundle ships with an
# empty backend URL, falls back to "/", and every API call hits the panel's own
# nginx (index.html / 405) — i.e. operator login is dead on arrival.
ARG VITE_MEDUSA_BACKEND_URL=http://backend:9000
ARG VITE_MEDUSA_STOREFRONT_URL=
ARG VITE_PUBLIC_BASE_URL=
ENV VITE_MEDUSA_BACKEND_URL=$VITE_MEDUSA_BACKEND_URL \
    VITE_MEDUSA_STOREFRONT_URL=$VITE_MEDUSA_STOREFRONT_URL \
    VITE_PUBLIC_BASE_URL=$VITE_PUBLIC_BASE_URL

RUN pnpm run build

# --- runtime stage -----------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime

RUN apk add --no-cache wget tini

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as the non-root nginx user (already created by the base image).
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
