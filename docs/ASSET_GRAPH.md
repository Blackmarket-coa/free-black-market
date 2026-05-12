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
(yard-scrap-nursery, tool-library, repair-cafe). The persistence
migration and catalog seeder shipped alongside v0; the matching
engine and sensitivity-tier cryptography are downstream.

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
  service.ts                        # catalog accessors + matcher entry points
  matcher.ts                        # pure matching engine
  models/                           # 7 model files (DB schema)
  migrations/
    Migration20260512CreateAssetGraph.ts  # all 7 tables + indexes
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
    seed.unit.spec.ts
    matcher.unit.spec.ts
    vc.unit.spec.ts
    instance-lifecycle.unit.spec.ts
    settlement.unit.spec.ts
  attestations/
    vc.ts                           # W3C VC body parser + extractors
  instance-lifecycle.ts             # state machines + acceptProposal payload
  settlement.ts                     # per-rail emission compose + validation

backend/src/scripts/
  seed-asset-graph.ts               # upserts asset_kind + project_manifest

docs/
  ASSET_GRAPH.md                    # this file
  manifests/
    yard-scrap-nursery.md
    tool-library.md
    repair-cafe.md
```

## Matching engine (v0.1)

`matcher.ts` is a pure-function engine that walks a manifest's required
asset kinds against a pool of `AssetDeclaration` rows and reports
which declarations satisfy each slot. The decomposition mirrors the
schema axes so each is testable in isolation:

| Function | Job |
| --- | --- |
| `evaluateConstraints(constraints, attributes)` | `{ acreage_min: 0.25 }` → `attributes.acreage >= 0.25`. Vocabulary: `_min`, `_max`, or exact-match. |
| `matchSlot(slot, pool)` | One slot's candidate declarations: kind-slug wildcard + lifecycle filter + constraints + revoked check. |
| `matchManifest(manifest, pool)` | Full report — per-slot reports plus a list of candidate operators (members whose declarations fill an operator-like role). |
| `proposalsFromReport(report)` | One `MatchProposal` payload per candidate operator. Score is 0 (incomplete) or 1 (complete). |

Service surface:

  - `runMatchManifest(slug, pool)` — in-memory dry-run; no DB I/O.
  - `proposeMatches({ manifest_slug, persist? })` — DB-backed match
    against live declarations; `persist` defaults to false so callers
    can preview proposals before committing them to `match_proposal`.

## Instance lifecycle

`instance-lifecycle.ts` owns the state machines that govern what
happens after the matcher emits a proposal:

```
  MatchProposal:    pending ──accept──→ accepted
                            ──decline─→ declined
                            ──expire──→ expired       (terminal)

  ProjectInstance:  draft   ──publish──→ active
                    active  ──pause────→ paused
                    paused  ──reactivate→ active
                    *       ──archive──→ archived     (terminal)
```

Pure functions: `transitionProposalState`, `transitionInstanceState`
(both throw `InvalidTransitionError` on illegal moves), and
`computeInstancePayload` (turns a proposal + linked declarations into
the `ProjectInstance` create payload, deduplicating member ids).

Service surface:

  - `acceptProposal({ proposal_id, state? })` — fetches the
    proposal, fetches its referenced declarations, creates a
    `ProjectInstance` (defaults to `state: 'active'`; pass
    `'draft'` to stage), marks the proposal `accepted`, returns
    both rows.
  - `declineProposal({ proposal_id })` — marks the proposal
    `declined` without creating an instance.
  - `publishInstance / pauseInstance / reactivateInstance /
    archiveInstance` — single-step state transitions on a live
    instance.

Idempotency: every transition method throws
`InvalidTransitionError` when called against a state that doesn't
permit the action. Accepting an already-accepted proposal is a
caller bug, not a no-op. Callers who want at-least-once semantics
should either catch the error or check state first.

## Settlement emission

`settlement.ts` is the asset-graph side of "when a project executes a
transaction, record what flowed." It composes a `SettlementRecord`
payload from a `SettlementIntent`, validates it twice (the rail must
be in the manifest's `settlement_rails`, and per-rail required fields
must be present), and the service persists the row with
`ledger_entry_id: null`.

Per-rail required fields:

| Rail | Required (in addition to common fields) |
| --- | --- |
| `ccr`   | `order_id`, `cart_id`, or recognized `reference_type` + `reference_id` (Posture A purchase context) |
| `hours` | `reference_type` ∈ {TIMEBANK_LOAN, TIMEBANK_RETURN, TIMEBANK_REDISTRIBUTION, TIMEBANK_OPEN_BALANCE} + non-empty `reference_id`; `from ≠ to` |
| `karma` | `karma_reason` slug; `from_member_id` may be "SYSTEM" or the counterparty that triggered the accrual |
| `usd`, `usdc` | `amount_minor > 0` |
| `gift`  | none (audit-only; amount may be 0) |

Service surface:

  - `emitSettlementRecord(intent)` — validate + persist with
    `ledger_entry_id: null`. Throws `SettlementValidationError` on
    a bad intent; the row is not written when validation fails.
  - `composeSettlementPayload(intent)` — pure preview; returns the
    payload without writing.

The unsettled `ledger_entry_id: null` is the v0.1 marker for "intent
recorded, hawala-ledger entry not yet written." A reconciler workflow
(v0.2, cross-module) reads unsettled records, mints the matching
hawala-ledger entry (or `karma_event` row, or nothing for GIFT), then
stamps `ledger_entry_id` on the SettlementRecord. That cross-module
stitching belongs in a workflow, not the module — same pattern this
codebase uses elsewhere.

The three reference manifests test three distinct match shapes:

  - **Nursery**: concrete-leaf slugs + numeric attribute constraints
    (`acreage_min`, `hours_per_week_min`). Cross-member assembly —
    operator's land + N household yard-scrap contributors.
  - **Tool library**: hierarchical wildcard (`tool.*`) + lifecycle
    filter (`exhaustible-borrow-return`). Librarian as coordinator-
    role candidate operator.
  - **Repair café**: skill wildcard on a different category root
    (`skill.repair.*`) + perishable event-shift lifecycle + the
    `client` role for consumer intake (excluded from operator
    candidacy). The event-loop scheduling primitive (fixer
    availability vs. event date vs. venue recurrence) is not part
    of the v0.1 engine — slot-level matching works, but proposing
    the *right* date is deferred.

## Out of scope for v0

- Sensitivity-tier cryptography (room-scoped + match-only enforcement).
- Operator panel UI surfaces.
- FBM/Commons boundary pricing rules.
- Refactoring existing modules into the new spine.
- Membership-requirement definition.
- Zod-schema serialization for `asset_kind.attribute_schema` — the
  seeder stores a pointer-to-code marker; the DB column is reserved
  for a future zod→JSON-schema serializer if a UI ever needs to
  render attribute forms from the DB instead of from code.
- Matching-engine extensions: scoring beyond 0/1 completeness,
  event-loop scheduling (fixer availability vs. event date vs. venue
  recurrence — the v0.1 engine matches at the slot level only),
  sensitivity-tier redaction of `MatchProposal.sensitivity_redacted_view`,
  and geography filtering of the declaration pool.

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
| `credential.cpr-certified` | ✓ credential category; ✓ `Attestation.external.vc_payload` parsed via the W3C VC schema (`attestations/vc.ts`) | ✗ cryptographic proof verification (DID resolution, signature checking) is its own workstream |
| `credential.background-check` | ✓ credential category; ✓ same VC schema covers it | ✗ revocation pull (BitstringStatusList) not yet wired |
| `time.recurring` (with kids' ages) | ✓ time taxonomy + attribute schema | ✗ no minor's-data sensitivity classification — needs `sensitivity_tier: minor-data` (or a dedicated tier) and crypto enforcement, both deferred |
| `skill.peer-support` | ✓ skill taxonomy | ✗ no "lived experience" attestation primitive (peer-vouched works in shape but pulls in cluster-3 norms about who can vouch) |

Settlement: hours (the time-bank rail) — already needed by tool
library; v0.1 lands it.

Governance: a childcare co-op needs `consensus` for new-family
admission. v0 has the enum value but no proposal/consent-round
workflow — that lives in Governance v2 (already on the post-composition
roadmap per `docs/COMPOSITION_LAYER.md`).

**Conclusion.** A childcare manifest cannot fully run on v0 because:

1. ~~The W3C Verifiable Credential payload slot needs a validation pass.~~
   **Landed in v0.1** (`attestations/vc.ts` parses VC bodies; the service
   `createAttestationWithVC` validates at write time). Cryptographic
   proof verification — DID resolution, signature/data-integrity-proof
   checking — is still its own workstream.
2. A `minor-data` sensitivity classification (or `match-only` with
   crypto) must be enforced, not just stored.
3. `consensus` governance needs proposal-round support (Governance v2
   dependency).
4. Credential revocation pull (BitstringStatusList) for the
   background-check VC isn't wired — the VC parses but a revoked
   credential would still be accepted.

It can be *written* on v0 as a draft, and the credential plumbing now
parses payloads structurally; operating it requires v1's crypto +
revocation + consensus governance. That's the correct discipline: the
schema generalizes structurally; operational depth lands one vertical
at a time, surfacing exactly the v1 work needed before the next
vertical can run.
