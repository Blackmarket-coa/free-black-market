# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Vendor panel (Vite + React) production image.
# Build artefact is a static bundle served by nginx-alpine.
# ----------------------------------------------------------------------------

ARG NODE_VERSION=20-bookworm-slim
ARG NGINX_VERSION=1.27-alpine

# --- build stage -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .

# Vite inlines VITE_* values into the static bundle at build time (loadEnv reads
# them from the build environment), so the backend URL and publishable key MUST
# be present here — a runtime env_file cannot change an already-built SPA. The
# ARG defaults keep a bare `docker build` working; CI/production overrides them
# via build-args (see .github/workflows/docker-build.yml). Without these the
# bundle ships with an empty backend URL, falls back to "/", and every API call
# hits the panel's own nginx (index.html / 405) — i.e. login is dead on arrival.
ARG VITE_MEDUSA_BACKEND_URL=http://backend:9000
ARG VITE_PUBLISHABLE_API_KEY=
ARG VITE_MEDUSA_STOREFRONT_URL=
ARG VITE_PUBLIC_BASE_URL=
ENV VITE_MEDUSA_BACKEND_URL=$VITE_MEDUSA_BACKEND_URL \
    VITE_PUBLISHABLE_API_KEY=$VITE_PUBLISHABLE_API_KEY \
    VITE_MEDUSA_STOREFRONT_URL=$VITE_MEDUSA_STOREFRONT_URL \
    VITE_PUBLIC_BASE_URL=$VITE_PUBLIC_BASE_URL

# build:preview emits the SPA bundle without the (heavier) tsup library output.
RUN pnpm run build:preview

# --- runtime stage -----------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime

RUN apk add --no-cache wget tini

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
