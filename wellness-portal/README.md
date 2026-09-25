# Wellness Portal

A vertical operator dashboard for wellness/herbal practitioners on
[Free Black Market](../README.md) (FBM). Built with React + Vite on the
shared `@bmc/portal-kit` and `@bmc/ui` workspace packages.

## Status

A vendor back-office dashboard, not a customer storefront, and not deployed:
there is no Dockerfile, compose service, nginx vhost or DNS name for it. In
dev (`pnpm wellness-portal:dev`) its data calls resolve from the typed mock
layer in `src/lib/mock/` unless `VITE_USE_MOCK_DATA=false`; production builds
call the backend. These backend routes it calls do not exist yet:

- `GET /vendor/wellness/physical-products`, `/digital-products`,
  `/payouts/current-period`, `/analytics/insights`
- the Blackout reads (`/api/blackout/client-dms`,
  `/api/blackout/client-dms/:roomId/messages`,
  `/api/blackout/community/messages`) — there is no Blackout proxy in the
  backend

## What it covers

- Listing management (physical and digital products, classes, sessions,
  memberships), plus a page that gives the practitioner a `connect.js` embed
  snippet for their own site
- Booking calendar, clients and payouts
- Blackout (Matrix-based) community feed

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cp wellness-portal/.env.example wellness-portal/.env   # fill in the values
pnpm wellness-portal:dev
```

Key environment variables (see `.env.example` for the full list):

- `VITE_FBM_API_URL` — the FBM backend URL.
- `VITE_PRACTITIONER_ID` / `VITE_PRACTITIONER_NAME` — local-dev shortcuts for
  the signed-in vendor; in production these come from the FBM vendor
  session.
- `VITE_CONNECT_PUBLISHABLE_KEY` — publishable key for the embedded
  storefront widget.
- `VITE_BLACKOUT_URL` — Blackout (Matrix) base; reads/writes are meant to be
  proxied through the FBM backend, never called directly from the browser
  (that proxy is not built yet — see Status).

## Related

- Backend API: `../backend/README.md`
- Playbook system: `../docs/PLAYBOOK_SYSTEM.md`
- Repository overview: `../README.md`
