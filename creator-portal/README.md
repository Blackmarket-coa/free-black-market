# Creator Portal

A vertical operator dashboard for independent creators monetizing an
audience on [Free Black Market](../README.md) (FBM) — the Creator playbook's
home surface. Built with React + Vite on the shared `@bmc/portal-kit` and
`@bmc/ui` workspace packages.

## Status

A vendor back-office dashboard, not a customer storefront, and not deployed:
there is no Dockerfile, compose service, nginx vhost or DNS name for it. In
dev (`pnpm creator-portal:dev`) its data calls resolve from the typed mock
layer in `src/lib/mock/` unless `VITE_USE_MOCK_DATA=false`; production builds
call the backend. These backend routes it calls do not exist yet:

- `GET /vendor/creator/analytics`, `/boosts`, `/governance/proposals`,
  `/splits`, and `POST /vendor/creator/splits/:id/activate`
- the Blackout reads (`/api/blackout/community/messages`,
  `/api/blackout/member-dms`, `/api/blackout/member-dms/:roomId/messages`) —
  there is no Blackout proxy in the backend

## What it covers

- Dashboard, analytics, and payouts
- Memberships and boosts
- Revenue splits (`SplitsPage`) — UI only until the `/vendor/creator/splits`
  routes above exist; the intended ledger tie-in is described in
  `../docs/COMPOSITION_LAYER.md`
- Stream overlay page and Blackout (Matrix) Space integration for
  split-contract proofs
- Quests and Coalition Credits balance
- A page that gives the creator a `connect.js` embed snippet for their own
  site

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cp creator-portal/.env.example creator-portal/.env   # fill in the values
pnpm creator-portal:dev
```

Key environment variables (see `.env.example` for the full list):

- `VITE_FBM_API_URL` — the FBM backend URL.
- `VITE_CREATOR_ID` / `VITE_CREATOR_NAME` — local-dev shortcuts for the
  signed-in creator; in production these come from the FBM vendor session.
- `VITE_CREATOR_SPACE_ID` — the creator's Blackout (Matrix) Space id.
- `VITE_CONNECT_PUBLISHABLE_KEY` — publishable key for the embedded
  storefront widget.
- `VITE_BLACKOUT_URL` — Blackout (Matrix) web app base; used to deep-link to
  Space state events and the stream overlay page. Blackout data reads are
  meant to go through the FBM backend (not built yet — see Status).

## Related

- Backend API: `../backend/README.md`
- Composition layer (Refrain creator bounties, ledger): `../docs/COMPOSITION_LAYER.md`
- Repository overview: `../README.md`
