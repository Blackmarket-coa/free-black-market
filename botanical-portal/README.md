# Botanical Portal

A vertical operator dashboard for general botanical-goods makers on
[Free Black Market](../README.md) (FBM) — an individual maker or a shared
production collective. Built with React + Vite on the shared
`@bmc/portal-kit` and `@bmc/ui` workspace packages.

## What it covers

- Production/inventory tracking for a maker or collective
- Optional linkage to an FBM nursery node for ingredient sourcing
- Listings and orders
- Blackout (Matrix-based) community feed

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cp botanical-portal/.env.example botanical-portal/.env   # fill in the values
pnpm botanical-portal:dev
```

Key environment variables (see `.env.example` for the full list):

- `VITE_FBM_API_URL` — the FBM backend URL.
- `VITE_OPERATOR_TYPE` — `maker` (single producer) or `collective` (shared
  production house). In production this comes from the vendor session; the
  env var is a dev-only shortcut.
- `VITE_NURSERY_NODE_ID` — optional link to a nursery node for ingredient
  sourcing.
- `VITE_BLACKOUT_URL` — Blackout (Matrix) base; all reads/writes are proxied
  through the FBM backend, never called directly from the browser.

## Related

- Backend API: `../backend/README.md`
- Nursery portal (ingredient sourcing): `../nursery-portal/README.md`
- Repository overview: `../README.md`
