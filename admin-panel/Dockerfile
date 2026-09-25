# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Admin panel (Vite + React) production image.
# Build artefact is a static bundle served by nginx-alpine.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=22-bookworm-slim
ARG NGINX_VERSION=1.31-alpine

# --- pnpm stage --------------------------------------------------------------
# Every stage that runs pnpm is FROM this one, so pnpm is fetched from the npm
# registry once per image, here, with a retry — not once per stage with none.
#
# It used to be the latter: each stage ran its own `corepack enable` and let
# its first `pnpm` call download pnpm. One fetch for this image, six across
# the four images `e2e.yml` builds in parallel with `docker compose up --build`,
# and any one of them failing failed the build.
# That is what happened on PR #859 (2026-09-22): ECONNRESET from the registry
# while corepack fetched pnpm.
#
# The version is read from package.json's `packageManager` field rather than
# repeated here, so the image cannot drift from what developers and CI run.
# `corepack prepare` is retried with a growing pause (1+4+9+16s) before the
# build gives up. The closing `pnpm --version` runs with corepack's network
# access switched off: it proves pnpm is usable from the cache alone, so no
# stage FROM this one can silently fall back to downloading it again.
FROM node:${NODE_VERSION} AS pnpm
WORKDIR /app
# Corepack keeps its downloads under COREPACK_HOME. Nothing in this image runs
# pnpm as a non-root user, but the fixed, world-readable location is the same
# one backend/Dockerfile relies on, so all four images set pnpm up identically.
ENV COREPACK_HOME=/opt/corepack
COPY package.json ./
RUN corepack enable \
    && pm="$(node -p "require('./package.json').packageManager")" \
    && for attempt in 1 2 3 4 5; do \
         corepack prepare "$pm" --activate && break; \
         [ "$attempt" = 5 ] && exit 1; \
         echo "corepack prepare $pm failed (attempt $attempt); retrying" >&2; \
         sleep $((attempt * attempt)); \
       done \
    && chmod -R a+rX /opt/corepack \
    && COREPACK_ENABLE_NETWORK=0 pnpm --version

# --- build stage -------------------------------------------------------------
FROM pnpm AS build
ENV NODE_ENV=production

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

# Cache-bust the security-update layer below.
#
# That `apk upgrade` is meant to pick up fixes published after the base tag
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
# `apk upgrade` is scoped to libuuid rather than run bare, deliberately.
# nginx and its modules in this base image come from NGINX Packaging (F5), not
# from Alpine main — `apk info` shows the maintainer on nginx 1.31.5-r1 as
# nginx-packaging@f5.com. A bare `apk upgrade` therefore upgrades nginx out of
# whatever the `1.31-alpine` tag pins it to, which is the one thing the pinned
# tag exists to prevent. libuuid is Alpine main (Natanael Copa), so upgrading it
# cannot touch the nginx line.
#
# SD-26: alpine 3.24.1 ships libuuid 2.42.1-r0, carrying seven fixed HIGH
# util-linux advisories (CVE-2026-53612/53613/53614/76642/78408/78409/78410).
# Alpine v3.24 has 2.42.3-r1; upstream has not rebuilt the nginx image against
# it, and every alpine tag — `alpine`, `1.31-alpine`, `stable-alpine` — carries
# the same stale package, so a tag bump does not help. See docs/AUDIT_DEBT.md.
RUN echo "security-refresh=${SECURITY_REFRESH}" >/dev/null \
    && apk add --no-cache wget tini \
    && apk upgrade --no-cache libuuid

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
