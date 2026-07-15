# Wellness Portal

A vertical operator dashboard for wellness/herbal practitioners on
[Free Black Market](../README.md) (FBM). Built with React + Vite on the
shared `@bmc/portal-kit` and `@bmc/ui` workspace packages.

## What it covers

- Practitioner storefront and listing management, embedded via `connect.js`
- Orders and payouts
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
- `VITE_BLACKOUT_URL` — Blackout (Matrix) base; all reads/writes are proxied
  through the FBM backend, never called directly from the browser.

## Related

- Backend API: `../backend/README.md`
- Playbook system: `../docs/PLAYBOOK_SYSTEM.md`
- Repository overview: `../README.md`
