# asset-graph

The intake/declaration layer for FBM. Members declare what they have
(land, tools, equipment, skills, time, capital, credentials, output
capacity); project manifests match those declarations to compositions
of the existing `playbook` and `listing-type` substrate.

This module is v0: **schema and reference manifests, no live engine,
no DB migration.** Persistence lands in v0.1.

## Why it exists

See `docs/ASSET_GRAPH.md` for the full thesis. Short version: BMC has a
strong composition layer but every vertical is a new product build.
With the asset graph, every vertical is a manifest — a declarative
recipe that says "this kind of project needs these asset kinds, settles
on these rails, uses this playbook and these listing-types, governs
this way, lives on this surface." Adding a vertical becomes
writing a manifest, not building a product.

## Files

- `manifests/types.ts` — zod schemas + enums. The parser of truth.
- `manifests/yard-scrap-nursery.ts` — reference manifest 1.
- `manifests/tool-library.ts` — reference manifest 2.
- `manifests/index.ts` — catalog (code-as-source-of-truth).
- `seed/asset-kinds.ts` — taxonomy seed.
- `models/*.ts` — 7 model files for v0.1 persistence (schema only in v0).
- `service.ts` — catalog accessors + wildcard slug matcher.
- `__tests__/manifest-parse.unit.spec.ts` — parser sanity.
- `__tests__/orthogonality.unit.spec.ts` — structural proof the schema
  generalizes (the two manifests must not warp to fit it).

## Conventions

Code is the source of truth for the manifest catalog and the asset
kind taxonomy. The corresponding `project_manifest` and `asset_kind`
tables are seeded from those catalogs at boot (v0.1 lands the seeder),
same pattern as `playbook` and `listing-type`. Adding a manifest is a
PR-reviewable code change, not a DB write.

The wildcard kind matcher (`tool.*` matches any subkind of tool) is in
`seed/asset-kinds.ts:matchesKindSlug`. The tool-library manifest uses
it; the nursery does not. Removing wildcard support breaks the tool
library, which is the right pressure.

## Reuse

The asset graph is **additive**. It plugs into:

- `playbook` (output recipe selected by `playbook_slug`)
- `listing-type` (offerings composed by `listing_type_slugs`)
- `hawala-ledger` (rails declared by `settlement_rails`;
  `SettlementRecord` wraps ledger entries)
- `vendor-verification` (producer-level verification ladder; in v0.1
  workflow maps these into per-declaration `Attestation`s)
- `entitlement` (membership gate for Commons-side access in v0.1)
- `producer`, `seller-extension` (existing seller surfaces)
- Threshold surface (where `surface: threshold` manifests live)

See `docs/ASSET_GRAPH.md` for the full reuse table.

## Status

v0 ships the schema and two manifests. The matching engine,
sensitivity-tier cryptography, and persistence migrations land in
v0.1. The `hours` rail and Karma asset-model placement in
`hawala-ledger` are flagged as v0.1 dependencies before the tool
library can run.
