# Creator Portal

A vertical operator dashboard for independent creators monetizing an
audience on [Free Black Market](../README.md) (FBM) — the Creator playbook's
home surface. Built with React + Vite on the shared `@bmc/portal-kit` and
`@bmc/ui` workspace packages.

## What it covers

- Dashboard, analytics, and payouts
- Memberships and boosts
- Revenue splits (`SplitsPage`) tied into the internal ledger — see
  `../docs/COMPOSITION_LAYER.md`
- Stream overlay page and Blackout (Matrix) Space integration for
  split-contract proofs
- Quests and Coalition Credits balance
- Embedded storefront connect flow via `connect.js`

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
  Space state events and the stream overlay page, always proxied through the
  FBM backend.

## Related

- Backend API: `../backend/README.md`
- Composition layer (Refrain creator bounties, ledger): `../docs/COMPOSITION_LAYER.md`
- Repository overview: `../README.md`
