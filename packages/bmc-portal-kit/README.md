# @bmc/portal-kit

Shared, framework-agnostic logic for the [Free Black Market](../../README.md)
(FBM) vertical portals (`nursery-portal`, `wellness-portal`,
`botanical-portal`, `creator-portal`).

## What's in here

- `api.ts` — typed FBM backend API client used across portals.
- `format.ts` — shared formatting helpers.
- `tiers.ts` — sliding-scale / patronage tier logic.
- `seam.ts` — the shared "seam" contract each portal implements against.

## Usage

Consumed as a workspace dependency (`@bmc/portal-kit`) by the portal apps —
not published or run standalone.

```bash
pnpm --filter @bmc/portal-kit test
```
