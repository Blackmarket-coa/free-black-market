# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Backend (MedusaJS 2) production image — multi-stage, non-root runtime.
# `restaurant-marketplace` is a local file: dependency referenced in
# package.json; it must be COPY-ed before `pnpm install` so the lockfile
# resolves cleanly.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=22-bookworm-slim

# --- pnpm stage --------------------------------------------------------------
# Every stage that runs pnpm is FROM this one, so pnpm is fetched from the npm
# registry once per image, here, with a retry — not once per stage with none.
#
# It used to be the latter: each stage ran its own `corepack enable` and let
# its first `pnpm` call download pnpm. Three fetches for this image, six
# across the four images `e2e.yml` builds in parallel with `docker compose up
# --build`, and any one of them failing failed the build.
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
# Corepack keeps its downloads under COREPACK_HOME; a fixed, world-readable
# location lets the non-root runtime user reuse what the build fetched. ENV
# persists into every stage FROM this one, so the runtime stage — and the
# container it boots — looks here too.
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

# --- deps stage --------------------------------------------------------------
FROM pnpm AS deps

# `pnpm-workspace.yaml` carries the dependency overrides, which pnpm 11 no
# longer reads from package.json. Omitting it here does not fail the build —
# it silently resolves the unpinned versions, which is how a CVE fix gets
# undone inside an image while every gate stays green.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY restaurant-marketplace ./restaurant-marketplace
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
FROM pnpm AS build
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/restaurant-marketplace ./restaurant-marketplace
COPY . .

# ENV does not cross stages, and `pnpm build` below is a script — so without
# this the deps check runs here even though the deps stage already set it.
# This is what failed the Docker backend build with ERR_PNPM_FETCH_429.
ENV pnpm_config_verify_deps_before_run=false

RUN rm -rf .medusa && pnpm build

# --- runtime stage -----------------------------------------------------------
# FROM the pnpm stage rather than node directly: that is where the pnpm that
# `pnpm start` runs comes from — see the note above the security-update RUN.
FROM pnpm AS runtime
ENV NODE_ENV=production
# Set in the RUNTIME stage too, not just the build, because the entrypoint is
# `pnpm start` — a script. Without this, pnpm 11 would contact the registry once
# per lockfile entry on EVERY CONTAINER BOOT. That is the same class of problem
# the pnpm stage's `corepack prepare` exists to prevent: this image already
# learned once that boot-time registry access is DNS-flaky in production and
# forced a `sleep` workaround.
ENV pnpm_config_verify_deps_before_run=false
ENV PORT=9000

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
# pnpm itself is inherited from the pnpm stage this one is FROM: its `corepack
# prepare` put pnpm under /opt/corepack and COREPACK_HOME points there, so
# `pnpm start` does NOT download it from the npm registry on every container
# boot (which was DNS-flaky and forced a `sleep` workaround in production).
#
# A `corepack enable && corepack prepare pnpm@11.20.0 --activate` used to sit
# in the RUN below, under a comment making that same promise. It did not keep
# it. The prepare ran as root, so corepack cached pnpm under its default
# location, /root/.cache/node/corepack; the container boots as `medusa`, whose
# corepack looks under /home/medusa/.cache/node/corepack — empty. Every new
# container fetched pnpm from the registry on its first boot regardless.
# Reproduced outside Docker on the same node 22 / corepack 0.34: prepare with
# one HOME, then `COREPACK_ENABLE_NETWORK=0 corepack pnpm --version` with
# another fails with "Network access disabled by the environment; can't reach
# https://registry.npmjs.org/pnpm/-/pnpm-11.20.0.tgz". A COREPACK_HOME shared
# with the build is the fix; the `pnpm --version` after `USER medusa` below is
# the proof.
RUN echo "security-refresh=${SECURITY_REFRESH}" >/dev/null \
    && groupadd -g 10001 medusa \
    && useradd -u 10001 -g medusa -s /usr/sbin/nologin -m medusa \
    && apt-get update && apt-get install -y --no-install-recommends wget tini ca-certificates \
    # Apply Debian security updates on top of whatever the base tag shipped
    # with. The node image is rebuilt on its own cadence, so a fixed package
    # can sit in bookworm-security for days before the tag picks it up; this
    # closes that window at our build time instead of waiting.
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    # npm is not used at runtime — the entrypoint is pnpm, installed by the pnpm
    # stage via corepack — but its bundled dependency tree is what a container
    # scan sees, and it carries the bulk of this image's HIGH/CRITICAL findings.
    # Removing an unused package manager is a smaller change than trying to
    # patch somebody else's vendored tree.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Bring in the built app, dependency tree, and runtime scripts.
# `src/` is required at runtime: medusa-config.ts resolves ~67 custom modules
# via `./src/modules/...` paths, so it must be present in the runtime image
# (otherwise module resolution fails and the server had to bind-mount src).
COPY --from=build --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=build --chown=medusa:medusa /app/src ./src
COPY --from=build --chown=medusa:medusa /app/node_modules ./node_modules
COPY --from=build --chown=medusa:medusa /app/restaurant-marketplace ./restaurant-marketplace
COPY --from=build --chown=medusa:medusa /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
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
# Build-time assertion that boot needs no registry. As the runtime user, with
# corepack's network access switched off, resolve the `packageManager` pinned
# in package.json from the cache alone. If this step fails, `pnpm start` would
# be downloading pnpm on every container boot again — and this file would be
# claiming otherwise, as it did once already.
RUN COREPACK_ENABLE_NETWORK=0 pnpm --version
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]
