# Asset Graph (v0)

## Why

FBM has a strong composition-layer substrate
(`playbook`, `listing-type`, `hawala-ledger`, the Threshold surface,
Coalition Credits, Karma) but lacks an **intake/declaration layer**.
Today, every vertical is a new product build. With the asset graph,
every vertical is a manifest — a declarative recipe that says
"this kind of project needs these asset kinds, settles on these rails,
uses this playbook and these listing-types, governs this way, lives on
this surface."

The asset graph is **additive**. It plugs into existing modules; it
does not replace them. See the reuse table at the bottom of this doc.

This document specifies v0: the schema and three reference manifests
(yard-scrap-nursery, tool-library, repair-cafe). v0 is schema-and-
catalog only. Persistence migrations, the matching engine, and the
sensitivity-tier cryptography are downstream.

## The pieces

```
                          ┌───────────────────────┐
                          │   ProjectManifest     │     code-of-truth
                          │ (yard-scrap-nursery,  │     in manifests/
                          │  tool-library,        │
                          │  repair-cafe)         │
                          └─────────┬─────────────┘
                                    │ selects + composes
                ┌───────────────────┼────────────────────┐
                │                   │                    │
        ┌───────▼─────┐    ┌────────▼────────┐   ┌───────▼─────────┐
        │  Playbook   │    │  ListingType    │   │  Settlement     │
        │  (existing) │    │   (existing)    │   │   rails         │
        │  10 recipes │    │  9 v1 types     │   │ (hawala-ledger) │
        └─────────────┘    └─────────────────┘   └─────────────────┘
                ▲                                       ▲
                │                                       │
                │ matches against                       │ scoped via
                │                                       │
        ┌───────┴────────────────────────────────────┐  │
        │              AssetDeclaration              │  │
        │  (member's intake; sensitivity + lifecycle │  │
        │   + availability + geography)              │  │
        └────────────────┬───────────────────────────┘  │
                         │                              │
              ┌──────────▼────────────┐    ┌────────────┴──────────┐
              │     AssetKind         │    │   SettlementRecord    │
              │ (taxonomy node;       │    │  (project-scoped wrap │
              │  attribute schema)    │    │   around ledger entry)│
              └───────────────────────┘    └───────────────────────┘
                         ▲                              ▲
                         │ vouched by                   │ emits via
              ┌──────────┴────────────┐                 │
              │     Attestation       │      ┌──────────┴─────────┐
              │ (self / peer /        │      │   ProjectInstance  │
              │  third-party)         │      │ (deployment of a   │
              └───────────────────────┘      │  manifest)         │
                                             └────────────────────┘
                                                       ▲
                                                       │
                                            ┌──────────┴──────────┐
                                            │   MatchProposal     │
                                            │ (engine output —    │
                                            │  v0 schema only)    │
                                            └─────────────────────┘
```

## Schema dimensions

Every declaration carries six axes; every manifest constrains them.

| Axis | Values |
| --- | --- |
| **Category** | `physical-artifact`, `space`, `skill`, `time`, `capital`, `credential`, `network-reach`, `output-capacity` |
| **Verification tier** (via Attestation) | `self-declared`, `peer-vouched`, `third-party-attested` |
| **Sensitivity tier** | `public`, `member-visible`, `room-scoped`, `match-only` |
| **Lifecycle** | `one-time`, `recurring`, `durable-commitment`, `perishable`, `exhaustible-borrow-return` |
| **Governance model** | `individual`, `collective`, `vote-weighted`, `consensus` |
| **Settlement rail** | `ccr`, `usdc`, `usd`, `karma`, `hours`, `gift` |

Crypto enforcement of `room-scoped` and `match-only` is deferred. v0
stores the tier; v0.x extends Blackout E2EE to the matching path.

## Hierarchical taxonomy

Slugs are dot-separated. A manifest may match a non-leaf with a single
trailing `.*` wildcard:

```
  tool                          (root)
  tool.power-tool               (subkind)
  tool.power-tool.drill         (leaf)

  manifest writes:   tool.*
  declaration writes: tool.power-tool.drill
  matchesKindSlug("tool.*", "tool.power-tool.drill") => true
```

The tool library uses `tool.*` for its lender slot precisely so it
doesn't have to enumerate every tool subkind. If the schema ever drops
wildcard support, that manifest stops parsing — which is the right
direction of pressure.

## Walk-through: yard-scrap nursery

Hand-traced end-to-end. Each step names the schema field that carries it.

1. **Operator signs up.** Anchored to a BMC Member identity →
   Stellar account (per `docs/COMPOSITION_LAYER.md`).
2. **Operator declares** `land.yard.residential` (`AssetDeclaration`)
   with `attributes: { acreage: 0.30, water_access: true }`,
   `sensitivity_tier: member-visible`, `lifecycle: durable-commitment`.
3. **Operator declares** `skill.horticulture`, `tool.vehicle.truck`, and
   `time.recurring` (`{ hours_per_week: 25 }`).
4. **Households declare** `output-capacity.yard-scrap`
   (`{ cubic_yards_per_month: 0.5 }`), `lifecycle: recurring`.
5. **Manifest match.** The asset-graph matcher (post-v0 engine; v0
   schema only) returns a `MatchProposal { manifest_slug:
   'yard-scrap-nursery', score: ... }` to the operator, citing every
   household declaration that satisfies the contributor slot.
6. **Operator deploys** the manifest → a `ProjectInstance` with
   `manifest_slug: 'yard-scrap-nursery'`, `state: active`. The
   underlying composition is the `grove` playbook with `physical_product
   + bookable + recurring` listing-types — i.e. ordinary FBM storefront
   surface.
7. **A household drops off scraps.** The hawala-ledger pays CCR to the
   household (`SettlementRecord { rail: 'ccr', manifest_slug:
   'yard-scrap-nursery' }` wraps the ledger entry).
8. **Operator sells a plant flat** on FBM. Standard MercurJS order;
   `SettlementRecord { rail: 'usd', ... }` records the USD edge
   settlement via Stripe ACH (existing pipe).

## Walk-through: tool library

1. **Members declare** `tool.*` leaves (`tool.power-tool.drill`,
   `tool.garden.tiller`, ...) with availability windows.
2. **A librarian declares** `time.coordinator` (`{ hours_per_week: 4 }`).
3. **A borrower** holds a `credential.trust-score` declaration —
   `sensitivity_tier: match-only` (only the librarian and the lender
   for a specific loan see it).
4. **Manifest deploys** as a `ProjectInstance` on the `commons`
   playbook, Threshold surface.
5. **Borrower books a drill via the `bookable` listing-type.**
   Reservation hold is just the MercurJS bookable flow.
6. **Loan completes.** Lender logs hours given (`SettlementRecord
   { rail: 'hours' }` once the hours rail lands). Borrower's
   trust-score `credential` accrues via a `peer-vouched`
   `Attestation` from the lender.
7. **Lost-tool case.** A `SettlementRecord { rail: 'ccr' }` moves
   Coalition Credits from borrower to the library to cover replacement
   (closed-loop guard satisfied because the payment is in a
   goods/services context: the replacement tool).

## Walk-through: repair café

1. **Fixer declares** `skill.repair.electronics` with
   `attributes: { soldering: true, smd_capable: false }`,
   `sensitivity_tier: member-visible`.
2. **Fixer declares** `time.event-shift` with
   `attributes: { hours: 3, event_date: '2026-06-13' }`,
   `lifecycle: perishable` — if they no-show, the slot is gone.
3. **Coordinator declares** `time.coordinator`
   (`{ hours_per_week: 2 }`), `lifecycle: recurring`.
4. **Venue host declares** `space.event-venue` with
   `attributes: { capacity: 40, accessible: true, recurrence: 'monthly-saturday' }`,
   `lifecycle: durable-commitment`.
5. **A customer walks up** and declares `artifact.broken-item` with
   `attributes: { category: 'electronics', symptom: 'no power',
   not_water_damaged: true }`, `lifecycle: one-time`,
   `sensitivity_tier: public`. The `client` role on this declaration
   tells the schema this is consumer intake, not contributor supply.
6. **Manifest match.** The matcher (v0.1) routes the broken-item
   declaration to a fixer whose `skill.repair.*` declaration's leaf
   slug matches the item's `category`. `skill.repair.electronics`
   matches `category: 'electronics'`.
7. **Manifest deploys** as a `ProjectInstance` on the `workshop`
   playbook, `threshold` surface, `event` + `bookable` listing-types.
   Customers can either walk in (`event`) or reserve a slot
   (`bookable`).
8. **Repair completes.** `SettlementRecord { rail: 'karma' }` accrues
   karma to the fixer. `SettlementRecord { rail: 'gift' }` marks the
   labor itself as gifted — no money changed hands.
9. **Repair fails.** The fixer marks the item beyond economical
   repair; the customer takes it back. No settlement records are
   written. The `one-time` lifecycle on `artifact.broken-item` is
   discharged either way.

## Reuse posture

| Existing concept | Role in asset graph |
| --- | --- |
| `playbook` (10 recipes) | Output pattern a manifest selects (`playbook_slug`) |
| `listing-type` (9 v1 types) | Offering shape a manifest composes (`listing_type_slugs`) |
| `hawala-ledger` (Stellar, USDC, CCR, Karma, EscrowAgreement) | Settlement rails (`settlement_rails`); `SettlementRecord` wraps ledger entries |
| `entitlement` | Membership gate that controls which declarations flow to Commons vs. FBM surfaces (v0.1) |
| `vendor-verification` | Producer-level verification ladder; in v0.1, projects to per-declaration `Attestation`s |
| `producer`, `seller-extension` | Existing seller surfaces; `Attestation` integrates rather than parallels |
| Threshold surface | Where `surface: threshold` manifests (tool library, repair café) live |
| `garden`, `agriculture`, `harvest`, `kitchen`, `donation`, `cooperative` | Domain modules supplying `AssetKind` taxonomy vocabulary |
| BMC Member identity → Stellar account | Identity anchor for `member_id` on declarations |

## Files

```
backend/src/modules/asset-graph/
  index.ts                          # module export
  service.ts                        # catalog accessors + matcher
  models/                           # 7 model files (DB schema; v0.1 migrates)
  manifests/
    types.ts                        # zod schemas + enums (parser of truth)
    yard-scrap-nursery.ts           # reference manifest 1
    tool-library.ts                 # reference manifest 2
    repair-cafe.ts                  # reference manifest 3
    index.ts                        # catalog
  seed/asset-kinds.ts               # v0 taxonomy seed (~38 kinds)
  __tests__/
    manifest-parse.unit.spec.ts
    orthogonality.unit.spec.ts

docs/
  ASSET_GRAPH.md                    # this file
  manifests/
    yard-scrap-nursery.md
    tool-library.md
    repair-cafe.md
```

## Out of scope for v0

- Matching engine implementation.
- Sensitivity-tier cryptography (room-scoped + match-only enforcement).
- Operator panel UI surfaces.
- Time-banking ledger fork-vs-extend decision (recommendation:
  extend `hawala-ledger`; decision deferred to its own plan).
- FBM/Commons boundary pricing rules.
- Refactoring existing modules into the new spine.
- DB migrations (models reviewable; persistence in v0.1).
- Membership-requirement definition.

## Open dependencies (verify during v0.1)

1. Does the matcher walk asset-graph kinds against the existing
   `producer` and `vendor-verification` data so verifications surface
   as attestations automatically? (Most likely yes via workflow.)
2. Should the `hours` rail live in `hawala-ledger` or in a sibling
   module? Recommendation: extend `hawala-ledger` with an `hours`
   asset, alongside CCR / USDC / Karma. Keeps a single ledger;
   protects the Posture A guard model.
3. The Karma asset is referenced in `docs/COMPOSITION_LAYER.md` but
   its model home is not finalized in `hawala-ledger/models/`. v0.1
   should land Karma in `hawala-ledger` before the tool-library
   instance executor lands.

## Appendix: Childcare sanity check (cluster-3 stress test)

A v0 childcare co-op manifest exposes what v0 **cannot yet do** and
therefore what v1 must add. This is the discipline that keeps the
schema from quietly overfitting to the production verticals.

What a childcare manifest needs to declare:

| Required asset kind (illustrative) | What v0 supports | What v0 lacks |
| --- | --- | --- |
| `space.home.childproofed` | ✓ space taxonomy node | ✓ attribute schema can carry `childproofed: true` |
| `credential.cpr-certified` | ✓ credential category | ✗ `Attestation.external` exists but v0 doesn't validate a Verifiable Credential payload — needs `vc_payload` schema in v0.1 |
| `credential.background-check` | ✓ credential category | ✗ same: v0 doesn't model background-check issuers or revocation pull |
| `time.recurring` (with kids' ages) | ✓ time taxonomy + attribute schema | ✗ no minor's-data sensitivity classification — needs `sensitivity_tier: minor-data` (or a dedicated tier) and crypto enforcement, both deferred |
| `skill.peer-support` | ✓ skill taxonomy | ✗ no "lived experience" attestation primitive (peer-vouched works in shape but pulls in cluster-3 norms about who can vouch) |

Settlement: hours (the time-bank rail) — already needed by tool
library; v0.1 lands it.

Governance: a childcare co-op needs `consensus` for new-family
admission. v0 has the enum value but no proposal/consent-round
workflow — that lives in Governance v2 (already on the post-composition
roadmap per `docs/COMPOSITION_LAYER.md`).

**Conclusion.** A childcare manifest cannot fully run on v0 because:

1. The W3C Verifiable Credential payload slot needs a validation pass.
2. A `minor-data` sensitivity classification (or `match-only` with
   crypto) must be enforced, not just stored.
3. `consensus` governance needs proposal-round support (Governance v2
   dependency).

It can be *written* on v0 as a draft, but operating it requires v1.
That's the correct discipline: the schema generalizes structurally;
operational depth lands one vertical at a time, surfacing exactly the
v1 work needed before the next vertical can run.
