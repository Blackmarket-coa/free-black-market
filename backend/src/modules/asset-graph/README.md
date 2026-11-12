# asset-graph

The intake/declaration layer for FBM. Members declare land, tools, equipment,
skills, time, capital, credentials and output capacity. Project manifests
compose the existing playbook and listing-type substrate.

## Implementation status — 2026-11-12

Substantive matching and persistence code exists. Earlier statements that this
module has no engine or migration are superseded by the source inventory below.
Code presence does not establish deployment, applied migrations, actual resource
availability or a completed tool-library/repair-cafe service.

| Area | Existing implementation | Remaining verification |
| --- | --- | --- |
| Catalogs | Asset kinds, manifest schema and reference manifests. | Confirm catalog seed in the intended database. |
| Persistence | Models, migration and catalog-seeding script. | Applied schema, seed results and tenant/access boundaries. |
| Matching | Constraint evaluation, slot matching and proposal generation in `matcher.ts`. | Real declarations, availability, match quality and complete user journey. |
| Proposal workflow | `proposeMatches`, `acceptProposal`, `declineProposal` in `service.ts`; acceptance creates a project instance. | Authorized approval, conflicting availability and downstream operations. |
| Project lifecycle | Publish, pause, reactivate and archive transitions. | UI behavior and lifecycle permissions in the running stack. |
| Attestations | Verifiable-credential handling in `attestations/vc.ts` and service methods. | Issuer trust, keys, expiry/revocation and deployed security validation. |
| Settlement | Intent validation/composition, idempotent records and reconciliation helpers. | Each rail's dependencies, flags and real settlement; a record alone is not payment. |

Source: [service](service.ts), [matcher](matcher.ts),
[lifecycle](instance-lifecycle.ts), [settlement](settlement.ts),
[reconciler](reconciler.ts), [credential helpers](attestations/vc.ts),
[migration](migrations/Migration20260512CreateAssetGraph.ts),
[catalog seeder](../../scripts/seed-asset-graph.ts).

## Why it exists

See [Asset Graph](../../../../docs/ASSET_GRAPH.md) for the design.
A vertical can compose declared resources through a manifest rather than
requiring a separate platform. The manifests are recipes, not proof of staffed
services or owned assets.

The catalog includes tool-library, repair-cafe, yard-scrap-nursery,
courier-collective, creator-bounty and childcare reference manifests.
Before operating any of them, validate the required resources, qualified
operators, scheduling, funding, permissions, maintenance and applicable terms.

## Files and conventions

- `manifests/types.ts`: schemas and enums.
- `manifests/index.ts`: code-owned manifest catalog.
- `seed/asset-kinds.ts`: taxonomy and wildcard kind matching.
- `models/`: persisted declarations, kinds, proposals, instances, attestations and settlement records.
- `__tests__/`: parsing, matching, lifecycle, declaration, settlement and related regression specifications.

The corresponding catalog tables are seeded from code. Adding a manifest is a
reviewable code change; it does not automatically provision a service.

## Reuse and release gates

The module composes playbook/listing types, producer/seller records, verification,
entitlements and settlement rails. It does not replace their access controls or
legal/runtime gates.

For equipment sharing, explicitly verify request, approval, availability,
handover, return, deposits/damage, disputes and maintenance. For repair events,
verify fixer availability against venue/date and event participation. For every
money/time-credit rail, verify the actual authorized downstream operation.

Use the [implementation and cost-reduction inventory](../../../../docs/IMPLEMENTATION_STATUS_AND_COST_REDUCTION.md)
to distinguish implemented code, default-off features and operational dependencies.
