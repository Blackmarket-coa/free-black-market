# Nursery Portal

A vertical operator dashboard for plant-nursery vendors on
[Free Black Market](../README.md) (FBM) — growers running a single node, or
network operators running a hub of multiple nursery nodes. Built with React +
Vite on the shared `@bmc/portal-kit` and `@bmc/ui` workspace packages.

## Status

A vendor back-office dashboard, not a customer storefront, and not deployed:
there is no Dockerfile, compose service, nginx vhost or DNS name for it. In
dev (`pnpm nursery-portal:dev`) its data calls resolve from the typed mock
layer in `src/lib/mock/` unless `VITE_USE_MOCK_DATA=false`; production builds
call the backend. These backend routes it calls do not exist yet:

- `GET /vendor/plant-nursery/listings`, `/wholesale`, `/network`, `/analytics`
- the Blackout feed reads (`/blackout/node-room/messages`,
  `/blackout/network-all/messages`, `/blackout/governance/proposals`) — there
  is no Blackout proxy in the backend

## What it covers

- Inventory and propagation tracking
- Listings and orders
- Wholesale flows
- Network view (for hub operators managing multiple nursery nodes)
- Payouts and analytics
- Seasonal quests and a Blackout (Matrix-based) community feed

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cp nursery-portal/.env.example nursery-portal/.env   # fill in the values
pnpm nursery-portal:dev
```

Key environment variables (see `.env.example` for the full list):

- `VITE_FBM_API_URL` — the FBM backend URL.
- `VITE_PORTAL_ROLE` — `node` (single grower) or `hub` (network operator). In
  production this comes from the vendor session; the env var is a dev-only
  shortcut.
- `VITE_BLACKOUT_URL` — Blackout (Matrix) base; reads/writes are meant to be
  proxied through the FBM backend, never called directly from the browser
  (that proxy is not built yet — see Status).

## Related

- Backend API: `../backend/README.md`
- Playbook system: `../docs/PLAYBOOK_SYSTEM.md`
- Repository overview: `../README.md`
