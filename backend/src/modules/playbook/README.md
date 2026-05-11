# playbook module

Cooperative-economic shape registry. A vendor picks one of ten playbooks
at setup (Stall, Atelier, Grove, Workshop, Commons, Cycle, Kitchen,
Harvest, Hub, Service). The choice determines governance shape, payout
structure, storefront identity, and default `VendorFeatures` extension
keys.

See `docs/PLAYBOOK_SYSTEM.md` for the canonical spec and the matrix of
allowed listing-types per playbook.

## Tables

- `playbook` — registry of the ten recipes (denormalized read cache).
- `playbook_assignment` — one row per seller; records picker answers
  + chosen recipe + whether the user overrode the recommendation.

## Source of truth

Recipe data lives in `recipes/<id>.ts` (one file per playbook). The DB
table is seeded from this catalog via
`backend/src/scripts/seed-playbooks.ts`. Edit the recipe file, re-run
the seed script.

## Workflow integration

- `assignPlaybookWorkflow` — assigns a playbook to a seller; called from
  the vendor-panel 3-question picker.
- `validateListingTypeAllowed` hook — enforces the
  playbook × listing-type matrix on `createProductsWorkflow.validate`.

## Recommendation function

`recommendPlaybook(answers)` is the pure decision tree behind the 3-
question picker. Same input always produces the same output. Tested in
`__tests__/recommend.unit.spec.ts` against all 120 answer permutations.

## Links

- `playbook-seller` — Seller ↔ PlaybookAssignment (1:1). Defensive
  loader pattern, see `backend/src/links/playbook-seller.ts`.
