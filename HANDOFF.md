# Handoff — asset-graph v0

Last touched: 2026-05-12. Branch: `claude/asset-graph-commons-dvAeT`.
Two commits beyond `main` after the composition-layer merge:

- `4875640` feat(asset-graph): v0 schema + nursery + tool-library reference manifests
- `8bc7694` feat(asset-graph): repair-cafe reference manifest (v0 third vertical)

Both pushed to `origin/claude/asset-graph-commons-dvAeT`. No PR open.

## What v0 is

Intake/declaration layer for FBM. Members declare assets; project
manifests compose those declarations onto the existing playbook +
listing-type + hawala-ledger spine.

v0 is **schema-and-catalog only**. No DB migrations. No matching
engine. No live UI. The three reference manifests prove the schema
generalizes:

| Manifest | Playbook | Surface | Governance | Rails | Wildcard | Unique lifecycles |
| --- | --- | --- | --- | --- | --- | --- |
| `yard-scrap-nursery` | grove | commerce | individual | ccr, usdc, usd, gift | — | (durable-commitment, recurring) |
| `tool-library` | commons | threshold | collective | hours, karma, ccr, gift | `tool.*` | exhaustible-borrow-return |
| `repair-cafe` | workshop | threshold | consensus | karma, gift | `skill.repair.*` | perishable, one-time |

Catalog-wide, the three manifests cover **every value** in the
`Lifecycle` and `SettlementRail` enums — the strongest available
structural proof at v0.

## Tests

```
cd backend
TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules \
  npx jest --runInBand --forceExit src/modules/asset-graph/__tests__/
```

30 passing across `manifest-parse.unit.spec.ts` (14) and
`orthogonality.unit.spec.ts` (16). Typecheck (`pnpm lint`) clean.

## Where to start next session

Read in this order:

1. `docs/ASSET_GRAPH.md` — full v0 spec, walk-throughs (nursery, tools,
   repair café), cluster-3 childcare sanity-check appendix.
2. `backend/src/modules/asset-graph/manifests/types.ts` — the zod
   schema that is the parser of truth.
3. `backend/src/modules/asset-graph/__tests__/orthogonality.unit.spec.ts`
   — the test that encodes "the schema generalizes," now with both
   pairwise and catalog-wide assertions.
4. `docs/manifests/{yard-scrap-nursery,tool-library,repair-cafe}.md`
   — per-manifest notes (rails, governance, what each manifest
   exercises that the others don't, open dependencies).

## What v0.1 needs to land

Ordered by what unblocks the most downstream work.

1. **DB migrations for the 7 models** under
   `backend/src/modules/asset-graph/models/`. Models are reviewable
   today; nothing persists yet. Pattern: copy the
   `Migration20260510CreatePlaybook.ts` shape from
   `backend/src/modules/playbook/migrations/`. Seed scripts for
   `asset_kind` (from `seed/asset-kinds.ts`) and `project_manifest`
   (from `manifests/`) wire in alongside the playbook seeder.

2. **Hours rail in `hawala-ledger`**. Recommendation in
   `docs/ASSET_GRAPH.md` § Open dependencies: extend the existing
   ledger with an `hours` asset alongside CCR / USDC / Karma — do not
   fork a separate time-bank module. Tool library cannot run an
   instance until this lands.

3. **Karma asset-model location** in `hawala-ledger/models/`. The
   composition-layer doc references Karma but the model home isn't
   finalized. Repair café accrues karma; this needs to be live before
   the repair-café instance executor lands.

4. **Matching engine**. v0 has `service.kindSlugMatches` (the
   wildcard matcher) but no proposal generator. The matcher walks
   manifest required-kinds against declarations and emits
   `MatchProposal` rows. The three manifests test three different
   match shapes:
     - nursery: concrete-leaf, attribute-constrained (acreage_min,
       hours_per_week_min)
     - tool library: hierarchical-wildcard, lifecycle-filtered
     - repair café: skill-vs-artifact-category routing,
       perishable-time scheduling against event date + venue series
   The third shape (event scheduling) is the one the playbook +
   listing-type spine doesn't fully cover yet — needs an event-loop
   primitive.

5. **Sensitivity-tier cryptography**. v0 stores `sensitivity_tier`
   on declarations and `sensitivity_floor` on manifests. Crypto
   enforcement (Blackout E2EE on `room-scoped` and `match-only`) is
   deferred. `credential.trust-score` is the v0 test case for the
   `match-only` tier.

6. **Attestation V0.1 work**. The cluster-3 childcare appendix in
   `docs/ASSET_GRAPH.md` flags that `Attestation.external` exists but
   v0 doesn't validate a W3C Verifiable Credential payload. v0.1
   should land the `vc_payload` zod schema.

7. **Entitlement → Commons/FBM boundary**. v0 declares
   `surface: commerce | threshold | refrain | blackstar` on each
   manifest. The membership gate that controls which declarations flow
   to which surface is unwired. Pricing rules (member-rate vs. retail)
   live in the FBM/Commons boundary spec — also pending.

## Decisions worth knowing

- **Manifest catalog is code-first**, seeded into `project_manifest`
  at boot. Same pattern as `playbook.recipes` and
  `listing-type.catalog`. Adding a vertical = writing a manifest +
  registering it; no DB write needed for catalog changes.
- **Wildcard matcher uses a single trailing `.*`** on slugs. No
  multi-level wildcards, no glob. Two manifests use it (`tool.*`,
  `skill.repair.*`) on distinct category roots; the test enforces
  this so the mechanism can't quietly become tool-specific.
- **Orthogonality test loosened from "no kind overlap" to "kind sets
  not identical + ≥2 unique slugs per side"** when the third manifest
  landed. Strict disjointness was a two-manifest accident — multiple
  manifests can legitimately share `time.coordinator`. The substantive
  invariant is catalog-wide enum coverage.
- **`workshop` playbook chosen for repair café** over `service` (solo
  practitioner) because repair cafés are collective volunteer events.
- **`event` listing-type used for repair café** (the Saturday is the
  event); `bookable` for advance slot reservations.
- **`client` role added** to `ManifestRole` enum to formalize
  "declaration made by someone receiving a service." Distinct from
  contributor / operator / lender.

## Open questions left for v0.1

- Karma accrual rules per repair / per loan. Schema slot exists;
  computation does not.
- Reputation algorithm for `credential.trust-score` (how prior loans
  accrue, how disputes deduct).
- Per-event scheduling primitive: how `time.event-shift` declarations
  reconcile with `space.event-venue` recurrence and matcher availability.
- Liability/waiver primitive for repair café — is this an
  `Attestation` shape or a separate model?
- Vote-weighted governance is the one governance-model enum value no
  v0 manifest uses. Either find the vertical that needs it or
  consider whether it should remain in the enum.

## Where this fits in the broader roadmap

`docs/COMPOSITION_LAYER.md` is the architecture this slots into.
The asset-graph module is **additive** — it plugs into existing
modules (`playbook`, `listing-type`, `hawala-ledger`,
`vendor-verification`, `entitlement`, `producer`, `seller-extension`)
without replacing any of them. See the reuse table in
`docs/ASSET_GRAPH.md` § Reuse posture.

The cluster-3 childcare manifest in the appendix of
`docs/ASSET_GRAPH.md` is the v1 stress test that documents what v0
**cannot yet do**: VC-payload validation, minor-data sensitivity
classification with crypto enforcement, consensus-governance proposal
rounds.
