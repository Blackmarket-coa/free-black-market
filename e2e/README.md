# End-to-End Tests

Playwright end-to-end suite for [Free Black Market](../README.md) (FBM),
exercising the running app stack across surfaces.

## Layout

- `tests/` — standard Playwright specs against the local stack:
  health checks, storefront browsing, vendor verification, and the admin
  panel's Disputes screens (`admin-disputes.spec.ts`, which mocks every
  `/admin/*` call in the browser and needs only the admin panel, at
  `ADMIN_URL`).
- `agents/` — a browser-driven agent harness (DOM-only shopping personas,
  commerce-invariant oracles, and a load swarm). See
  [`agents/README.md`](agents/README.md) for the rules and architecture.

## Running

Requires the local stack (backend + storefront, see the repo root
`README.md`) to be up.

```bash
cd e2e
pnpm install

pnpm test           # standard specs
pnpm test:ui        # Playwright UI mode
pnpm report         # open the HTML report

pnpm agents         # agent-harness personas
pnpm test:agents:stress   # load swarm
```
