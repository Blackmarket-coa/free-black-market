# Handoff — asset-graph v0

Last touched: 2026-05-13. Branch: `claude/asset-graph-commons-dvAeT`.
Sixteen commits beyond `main` after the composition-layer merge:

- `4875640` feat(asset-graph): v0 schema + nursery + tool-library reference manifests
- `8bc7694` feat(asset-graph): repair-cafe reference manifest (v0 third vertical)
- `9c32064` feat(asset-graph): persistence migration + catalog seeder
- `42bef9d` feat(hawala-ledger): rails registry + HRS + KARMA + karma_event model
- `37de7b9` feat(asset-graph): matching engine — proposal generator
- `4cc657a` feat(asset-graph): W3C Verifiable Credential payload validation
- `420771f` feat(asset-graph): ProjectInstance lifecycle (acceptProposal + state machines)
- `bebe498` feat(asset-graph): SettlementRecord emission (rail-validating compose + service)
- `a25b775` feat(asset-graph): cross-module settlement reconciler (job + module core)
- `77b928b` feat(asset-graph): childcare-coop reference manifest (cluster-3 lands)
- `f8f257f` refactor(hawala-ledger): defense-in-depth — createTransfer uses assertRailInvariants
- `c7e2c5a` feat(asset-graph): emission idempotency keys on SettlementRecord
- `a4142ca` feat(asset-graph): admin HTTP API surface (12 endpoints)
- `6137a78` feat(asset-graph): creator-bounty-pool reference manifest (vote-weighted vertical; 5th manifest)
- `b5732ab` feat(asset-graph): storefront HTTP API surface (7 endpoints) + createDeclarationFor + revokeDeclaration
- (pending) feat(asset-graph): courier-collective reference manifest (blackstar; 6th manifest; full enum coverage)

All pushed to `origin/claude/asset-graph-commons-dvAeT`. No PR open.

## What's on this branch

Intake/declaration layer for FBM. Members declare assets; project
manifests compose those declarations onto the existing playbook +
listing-type + hawala-ledger spine. The end-to-end narrative is
live: members declare → matcher proposes → operator accepts (live
ProjectInstance) → instance emits SettlementRecords → cross-module
reconciler writes to hawala-ledger.

Six reference manifests cover the schema:

| Manifest | Playbook | Surface | Governance | Sens. floor | Rails | Wildcard |
| --- | --- | --- | --- | --- | --- | --- |
| `yard-scrap-nursery` | grove | commerce | individual | member-visible | ccr, usdc, usd, gift | — |
| `tool-library` | commons | threshold | collective | member-visible | hours, karma, ccr, gift | `tool.*` |
| `repair-cafe` | workshop | threshold | consensus | public | karma, gift | `skill.repair.*` |
| `childcare-coop` | commons | threshold | consensus | match-only | hours, karma, gift | — |
| `creator-bounty-pool` | atelier | refrain | vote-weighted | public | usdc, karma, gift | `skill.creative.*` |
| `courier-collective` | workshop | blackstar | collective | member-visible | usdc, hours, karma, gift | `tool.vehicle.*` (depth-2) |

Catalog-wide, the six manifests cover **every value** in all four
manifest-schema enums: `Lifecycle` (5/5), `SettlementRail` (6/6),
`GovernanceModel` (4/4), and `Surface` (4/4). They also cover four
of ten playbooks (grove, commons, workshop, atelier) and four
wildcard category roots (`tool.*`, `skill.repair.*`,
`skill.creative.*`, `tool.vehicle.*` — including a depth-2 case).

The substrate fits production verticals (commerce), mutual-aid
(threshold), creator-bounty (refrain), and delivery (blackstar)
without warping — four-axis enum coverage is the strongest
available structural proof.

## Tests

```
cd backend
TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules \
  npx jest --runInBand --forceExit \
  src/modules/asset-graph/__tests__/ src/modules/hawala-ledger/__tests__/
```

200 asset-graph + 61 hawala-ledger = 261 passing tests on the branch.
Typecheck (`npx tsc --noEmit`) clean. Spec files:

  - manifest-parse.unit.spec.ts       — catalog + asset-kind sanity
  - orthogonality.unit.spec.ts        — pairwise + catalog-coverage
  - seed.unit.spec.ts                 — seeder idempotency
  - matcher.unit.spec.ts              — slot-level matching (all 4 manifests)
  - vc.unit.spec.ts                   — W3C VC parser
  - instance-lifecycle.unit.spec.ts   — state machines + service orchestration
  - settlement.unit.spec.ts           — emission compose + per-rail validation
  - reconciler.unit.spec.ts           — cross-module reconciliation
  - hawala-ledger rails.unit.spec.ts  — rail registry
  - hawala-ledger rails-guard.unit.spec.ts — HRS / KARMA guards

## Where to start next session

Read in this order:

1. `docs/ASSET_GRAPH.md` — full v0/v0.1 spec; walk-throughs (nursery,
   tools, repair café); matcher / instance-lifecycle / settlement
   / reconciler sections; cluster-3 appendix now points to a real
   manifest.
2. `backend/src/modules/asset-graph/manifests/types.ts` — the zod
   schema that is the parser of truth.
3. `backend/src/modules/asset-graph/__tests__/orthogonality.unit.spec.ts`
   — the test that encodes "the schema generalizes," pairwise +
   catalog-coverage.
4. `docs/manifests/{yard-scrap-nursery,tool-library,repair-cafe,childcare}.md`
   — per-manifest notes (rails, governance, what each manifest
   exercises that the others don't, open dependencies).

## What v0.1 needs to land

Ordered by what unblocks the most downstream work.

1. ~~**DB migrations for the 7 models**~~ **Landed** in commit on this
   branch: `backend/src/modules/asset-graph/migrations/Migration20260512CreateAssetGraph.ts`
   creates `asset_kind`, `asset_declaration`, `attestation`,
   `project_manifest`, `project_instance`, `match_proposal`, and
   `settlement_record`. Seeder at
   `backend/src/scripts/seed-asset-graph.ts` upserts both catalog
   tables from the in-code source of truth (run:
   `pnpm medusa exec ./src/scripts/seed-asset-graph.ts`).
   Idempotency proven by `__tests__/seed.unit.spec.ts`.

2. ~~**Hours rail in `hawala-ledger`**~~ **Landed** in the most
   recent commit. New `backend/src/modules/hawala-ledger/rails.ts`
   is the single-source-of-truth registry for all six rails
   (CCR/USDC/USD/KARMA/HRS/GIFT). `posture-a-guard.ts` gains a
   per-rail dispatcher `assertRailInvariants` plus dedicated
   functions for HRS (time-bank reference vocabulary) and KARMA
   (rejects user-to-user transfers — use `karma_event` instead).
   `dual-rail-selector.ts` now throws `NonCashRailError` on
   closed-loop rails rather than silently routing them to Stripe.
   `LedgerAccount.account_type` gains `TIME_BANK` for HRS balances.

3. ~~**Karma asset-model location**~~ **Landed** same commit.
   New `KarmaEvent` model + migration. Karma is non-fungible and
   non-transferable (per `docs/COMPOSITION_LAYER.md`), so the model
   is a per-member signed-delta event log (`member_id`, `delta`,
   `reason`, `source_module`, `source_id`, `occurred_at`) rather
   than a double-entry ledger account.

4. ~~**Matching engine**~~ **Landed** in the most recent commit.
   New `backend/src/modules/asset-graph/matcher.ts` is a pure-function
   engine: `evaluateConstraints` (the `<key>_min` / `<key>_max` /
   exact attribute vocabulary), `matchSlot` (one slot against the
   declaration pool — kind_slug wildcard + lifecycle + constraints +
   revoked filter), `matchManifest` (assembles per-slot reports +
   identifies candidate operators), and `proposalsFromReport` (turns
   a report into `MatchProposal` payloads — one per candidate
   operator). Service surface gains `runMatchManifest` (in-memory
   dry-run) and `proposeMatches({ persist? })` (DB-backed; persist
   defaults to false so callers can preview before committing).
   34 new tests cover all three manifest match-shapes (nursery
   concrete + constraints + cross-member assembly; tool-library
   wildcard + lifecycle; repair-café skill wildcard + perishable
   shift + client/customer not-an-operator) plus the constraint
   vocabulary, revoked-declaration skipping, optional-slot semantics,
   and proposal scoring (0 for incomplete, 1 for complete; richer
   scoring is post-v0.1).

   Still out of scope: event-loop scheduling (repair-café's fixer
   availability vs. event date vs. venue recurrence), sensitivity-
   tier redaction in `MatchProposal.sensitivity_redacted_view`
   (deferred to the Blackout E2EE work), and geography filtering.

5. **Sensitivity-tier cryptography**. v0 stores `sensitivity_tier`
   on declarations and `sensitivity_floor` on manifests. Crypto
   enforcement (Blackout E2EE on `room-scoped` and `match-only`) is
   deferred. `credential.trust-score` is the v0 test case for the
   `match-only` tier.

6. ~~**Attestation V0.1 work**~~ **Landed** in the most recent
   commit. New `backend/src/modules/asset-graph/attestations/vc.ts`
   defines a W3C Verifiable Credential zod schema (covers v1
   `issuanceDate/expirationDate` and v2 `validFrom/validUntil`
   contexts) plus extractors for issuer id, credential subjects,
   validity window, and a `looksLikeVCPayload` heuristic that lets
   legacy non-VC `external` payloads bypass VC validation. Service
   gains `createAttestationWithVC` (validates `vc_payload` at write
   time, refuses malformed credentials, defaults `expires_at` from
   the VC's validity window) and `isAttestationVCCurrentlyValid`.

   **Cryptographic proof verification** (DID resolution, signature
   checking, data-integrity-proof verification, BitstringStatusList
   revocation pull) is intentionally not in v0.1 — it requires a
   verifier library (didkit / veramo / ssi.js) and is its own
   workstream. v0.1 catches malformed payloads structurally so the
   cluster-3 childcare manifest's `credential.cpr-certified` and
   `credential.background-check` declarations can carry real VCs in
   the meantime.

7. **Entitlement → Commons/FBM boundary**. v0 declares
   `surface: commerce | threshold | refrain | blackstar` on each
   manifest. The membership gate that controls which declarations flow
   to which surface is unwired. Pricing rules (member-rate vs. retail)
   live in the FBM/Commons boundary spec — also pending.

8. **Attribute-schema portability**. The seeder stores a pointer-to-
   code marker in `asset_kind.attribute_schema` rather than serializing
   the zod schema (zod isn't JSON). Service reads bypass the DB for
   the canonical schema. Decide whether to ship a zod-to-JSON-schema
   serializer (adds a dep) or keep code-as-truth indefinitely (current
   bet — fine until a UI wants to render declaration forms from the
   DB).

9. **ProjectInstance lifecycle** ✓ — landed in `420771f`.
   New `instance-lifecycle.ts` defines the
   MatchProposal and ProjectInstance state machines (pure
   `transitionProposalState` + `transitionInstanceState`, both
   throw `InvalidTransitionError` on illegal moves) plus
   `computeInstancePayload` that turns an accepted proposal into
   a ProjectInstance create payload. Service gains
   `acceptProposal`, `declineProposal`, `publishInstance`,
   `pauseInstance`, `reactivateInstance`, `archiveInstance`.

   Closes the loop the matcher opened: `proposeMatches` →
   `acceptProposal` → live `ProjectInstance`. The instance carries
   manifest_slug + operator + the deduplicated set of all
   participating members.

   Open follow-ups:
     - Geography assignment on the instance (declaration centroid?)
     - Re-validation at accept time (declarations may have been
       revoked between match and accept)
     - Cross-instance coordination policy (multiple instances of the
       same manifest by the same operator allowed by schema; policy
       belongs higher up).

10. **SettlementRecord emission** ✓ — landed in `bebe498`.
    New `settlement.ts` is the asset-graph side of "when a project
    executes a transaction, record what flowed":
    `composeSettlement(intent)` validates the rail against the
    manifest's `settlement_rails`, validates per-rail required fields
    (CCR purchase context, HRS time-bank reference, KARMA reason,
    USD/USDC positive amount, GIFT audit-only), and returns the
    `SettlementRecord` payload with `ledger_entry_id: null`. Service
    method `emitSettlementRecord(intent)` persists the row; throws
    `SettlementValidationError` and skips the write on bad input.

11. **Cross-module settlement reconciler** ✓ — landed in the most
    recent commit. The asset-graph → hawala-ledger reconciler closes
    the loop emission opened. Per-record logic in
    `backend/src/modules/asset-graph/reconciler.ts` (unit-testable
    with fake services); scheduled cron job at
    `backend/src/jobs/asset-graph-settlement-reconciler.ts` (every
    15 minutes) iterates unsettled records.

    Per-rail dispatch:
      - CCR / USDC / USD → `createTransfer` between members'
        `USER_WALLET` accounts (currency = rail unit)
      - HRS → `createTransfer` between members' `TIME_BANK`-HRS
        accounts, carrying TIMEBANK_* reference vocabulary
      - KARMA → `createKarmaEvents` (no counterparty)
      - GIFT → metadata stamp only (audit-only)

    Idempotency:
      - `createTransfer` invoked with idempotency_key
        `settlement-${record.id}` so re-runs return the existing entry.
      - KARMA paths skip when a karma_event with `source_id:
        record.id` already exists.
      - GIFT and post-write records short-circuit on
        `metadata.reconciled_at`.

    19 reconciler tests cover every rail's write path, idempotency
    via existing entries, missing-account failures, the batch-loop
    continue-past-failure semantics, and the `listSettlementRecords({
    ledger_entry_id: null })` filter.

    Open follow-ups:
      - Member → ledger-owner mapping. Reconciler hardcodes
        `owner_type: "CUSTOMER"` today; the entitlement workstream
        (item 7) owns the proper mapping.
      - ~~Migrating hawala-ledger's `createTransfer` from
        `assertPurchaseContext` to `assertRailInvariants` so HRS-
        coded transfers get the time-bank guard at the ledger layer
        too~~ ✓ landed in `f8f257f`.
      - ~~Idempotency keys on settlement-record emission so duplicate
        intents don't write two rows~~ ✓ landed in the most recent
        commit (item 13 below).

12. **Childcare co-op (4th reference manifest)** ✓ — landed in the
    most recent commit. The cluster-3 stress test that has been a
    thinking aid in the docs since v0 is now a concrete manifest at
    `backend/src/modules/asset-graph/manifests/childcare.ts`.

    Schema additions:
      - 5 new asset-kind seeds: `space.home`, `skill.childcare`,
        `skill.peer-support`, `credential.cpr-certified`,
        `credential.background-check`. Total catalog now ~43 nodes.
      - 1 new ManifestRole: `caregiver` (intentionally not in
        `OPERATOR_LIKE_ROLES` — caregivers are participants, like
        fixers and clients; coordinator + host are deployment anchors).

    Schema axes exercised (none required new top-level concepts):
      - Multi-count slots: caregivers ≥3, background checks ≥3.
        First manifest to stress min_count > 1.
      - Boolean attribute constraint: `space.home` with
        `childproofed: true`. First manifest to use the boolean
        path of the constraint vocabulary.
      - `match-only` sensitivity floor. Records intent — crypto
        enforcement is the open dep below.
      - VC-typed credential declarations (the v0.1 attestation
        work's actual operational use case).
      - Second manifest on the `commons` playbook (tool library was
        first). Pairwise orthogonality preserved because they
        differ on governance (collective vs. consensus).

    Orthogonality test loosened: the previous pairwise "every pair
    exercises at least one lifecycle the other does not" invariant
    was useful at N=2,3 but became too strict at N=4 — nursery
    and childcare both use `{durable-commitment, recurring}`
    legitimately. Dropped in favor of the catalog-coverage
    assertion (every Lifecycle enum value exercised). The
    `(playbook, governance, surface)` pairwise differential still
    rules out duplicate-shape manifests.

    Operational status — draft, not yet runnable. Three v1 deps
    remain (per the cluster-3 doctrine: each new vertical surfaces
    exactly the v1 work needed before it can run):

      1. ~~W3C Verifiable Credential payload validation~~ ✓ (v0.1)
      2. ✗ **Minor-data sensitivity crypto enforcement.** Manifest
         sets `sensitivity_floor: match-only` but Blackout E2EE
         is the workstream that enforces it.
      3. ✗ **Consensus governance proposal rounds.** Schema records
         intent; workflow is Governance v2.
      4. ✗ **Background-check revocation pull (BitstringStatusList).**

    8 new matcher tests (multi-count, boolean constraint, the
    `match-only` floor, every required slot) + 2 new orthogonality
    blocks. Asset-graph tests: 200 passing (was 192).

13. **Defense-in-depth + emission idempotency** ✓ — the two
    HANDOFF item-11 follow-ups landed.

    `f8f257f` refactor(hawala-ledger): `createTransfer` now calls
    `assertRailInvariants` instead of `assertPurchaseContext`. The
    dispatcher handles CCR identically (delegates back to the
    purchase-context check); HRS/KARMA paths get their per-rail
    guards at the ledger layer for the first time; unknown
    currency codes throw rather than silently writing. No existing
    caller breaks because no existing caller uses HRS/KARMA via
    `createTransfer`.

    (most recent commit) feat(asset-graph): `SettlementRecord` gains
    an `idempotency_key` column with a partial unique index
    (enforced only when not null + not deleted; Medusa's model DSL
    doesn't chain `.nullable().unique()` so the DB index is the
    canonical guard). `SettlementIntent` carries an optional
    `idempotency_key`; `composeSettlement` threads it through; the
    service's `emitSettlementRecord` checks for an existing record
    by key before writing and returns the existing row when one
    matches. Validation still runs before the lookup so a bad rail
    throws regardless of the key.

    Convention for systematic emitters: `${manifest_slug}-${source_event_id}`
    (e.g. `"tool-library-loan_42-return"`). Without a key, the
    caller is responsible for dedup — same posture
    hawala-ledger's `createTransfer` takes.

    7 new tests in settlement.unit.spec.ts (compose threads + null
    default; service returns existing row on key match; no dedup
    without a key; distinct keys both write; lookup happens before
    write; validation runs before the lookup).

    Asset-graph tests: 207 passing (was 200).

    Open follow-up: applying idempotency_key everywhere a caller
    emits. The reconciler currently doesn't supply one because the
    SettlementRecord IS the source-of-truth for "what should
    settle"; idempotency is at the consumer (reconciler) side via
    the hawala-ledger entry's idempotency_key. But operator-
    triggered emits and future workflow steps SHOULD supply one
    when they have a natural event id.

14. **Admin HTTP API surface** ✓ — landed in the most recent
    commit. The substrate is now driveable from outside the
    service layer. 12 endpoints across 11 route files under
    `backend/src/api/admin/asset-graph/`:

      GET    /manifests                         catalog list
      GET    /manifests/:slug                   one manifest
      GET    /asset-kinds                       taxonomy list
      POST   /manifests/:slug/match             run matcher (persist?)
      GET    /proposals                         list with filters
      POST   /proposals/:id/accept              → ProjectInstance
      POST   /proposals/:id/decline
      GET    /instances                         list with filters
      POST   /instances/:id/publish             draft → active
      POST   /instances/:id/pause               active → paused
      POST   /instances/:id/reactivate          paused → active
      POST   /instances/:id/archive             * → archived

    Error mapping is consistent across routes:
      - 400 missing path param
      - 404 unknown manifest slug
      - 409 invalid state-machine transition (with from/action in body)
      - 500 other server errors

    Routes are thin wrappers around the service surface — no new
    business logic. Service tests cover the meaningful behavior;
    route-level integration tests follow this codebase's convention
    of no co-located route tests.

    Out of scope for v0.1:
      - Member-side declaration endpoints (different auth wiring;
        belongs under `/store/asset-graph/...`).
      - Settlement emission endpoint (driven by workflows/jobs, not
        admin actions).
      - Vendor-panel UI for these routes (frontend work; the API
        unblocks it but the UI is its own commit stream).

15. **Creator-bounty-pool (5th reference manifest)** ✓ — landed in
    the most recent commit. The vote-weighted vertical that closes
    out the GovernanceModel enum and exercises the previously-
    unused `capital` asset category + `refrain` surface +
    `atelier` playbook.

    Schema additions:
      - 8 new asset-kind seeds: `skill.creative` root + visual /
        writing / music leaves; `output-capacity.creative-work`
        (lifecycle: one-time); `capital` root +
        `capital.bounty-contribution` (first concrete capital
        kind); `credential.creator-verification` (VC-typed,
        optional). Catalog now ~51 nodes.

    Schema axes exercised (no schema changes required):
      - `vote-weighted` governance — last unused enum value.
        Supporters' `amount_minor` on their pledge weights their
        vote on which queued work the creator funds next. Tally
        workflow lives in Governance v2; v0.1 captures the data
        shape.
      - `refrain` surface — third distinct surface in the catalog
        (commerce, threshold, refrain). `blackstar` remains the
        only unused surface.
      - `atelier` playbook — fourth distinct playbook (after grove,
        commons, workshop).
      - `capital` asset category — the enum value existed since v0
        but had no concrete kind seeded; bounty-contribution is the
        first.
      - `skill.creative.*` wildcard — third distinct wildcard
        category root (after tool.* and skill.repair.*). The
        orthogonality test now asserts three wildcard roots as a
        structural fact.

    Catalog-wide structural proof, recorded in orthogonality tests:
      - Every value in Lifecycle enum exercised (was the case at
        N=4 already)
      - Every value in SettlementRail enum exercised (was the case
        at N=4 already)
      - Every value in GovernanceModel enum exercised (NEW — was
        3/4 at N=4)
      - ≥4 distinct playbooks (NEW floor; was ≥3)
      - ≥3 distinct surfaces (NEW floor; was ≥2)
      - 3 wildcard roots (asserted as a set equality, not just a
        floor)

    Tests: 8 new (6 matcher fixture + 2 orthogonality blocks). 215
    asset-graph unit tests passing (was 207). Typecheck clean.

    Open follow-ups:
      - Vote-tally workflow (Governance v2 dependency, same as
        consensus rounds for childcare).
      - Per-pledge attribution: each supporter's karma_event should
        carry their pledge id as `source_id` so accruals are
        traceable.
      - Refund logic on undelivered work (workflow concern).

16. **Storefront HTTP API + service surface for member-side
    declarations** ✓ — landed in the most recent commit. Closes the
    last admin/store gap the admin API left.

    Service surface:
      - `createDeclarationFor({ member_id, kind_slug, attributes, ... })`
        — looks up the kind in the catalog, validates attributes
        against the kind's zod schema in strict mode (unknown keys
        rejected, wrong types rejected), defaults lifecycle and
        sensitivity_tier from the kind when caller doesn't override,
        defaults governance_model to "individual". Throws on bad
        slug or attribute validation; routes translate to 400.

      - `revokeDeclaration({ declaration_id, member_id })` — sets
        `revoked_at` when ownership matches; returns `null` when
        the declaration doesn't exist OR belongs to a different
        member. Routes 404 either way — deliberately doesn't leak
        existence to non-owners.

    7 storefront endpoints under `/store/asset-graph/`:
      GET    /manifests                       public catalog
      GET    /manifests/:slug                   public one
      GET    /declarations                     list own (auth filter)
      POST   /declarations                     create own; validates
      DELETE /declarations/:id                 revoke own (404 non-owner)
      GET    /proposals                        list own
      POST   /proposals/:id/accept             accept own → instance
      POST   /proposals/:id/decline            decline own

    Auth + ownership posture:
      - All authenticated endpoints 401 on missing
        `auth_context.actor_id`.
      - List endpoints filter by caller's member_id.
      - Mutation endpoints 404 on non-owner (don't leak existence).
      - Validation failures (zod schema, unknown kind) → 400 with
        structured issue details.
      - InvalidTransitionError → 409 with from/action in body.

    Tests: 14 new unit tests in `declarations.unit.spec.ts`. The
    routes themselves are thin wrappers (codebase convention is no
    co-located route tests — integration-test territory).

    229 asset-graph unit tests passing (was 215). Typecheck clean.

    Open follow-up: route-level integration tests if the codebase
    standardizes on them. Existing admin routes don't have them
    either; this commit follows the existing posture.

17. **Courier-collective (6th reference manifest)** ✓ — landed in
    the most recent commit. The blackstar/delivery vertical that
    closes Surface enum coverage. With this manifest the substrate
    has demonstrated structural fit on every value of every enum
    the schema cares about — Lifecycle, SettlementRail,
    GovernanceModel, AND Surface. Four-axis full enum coverage.

    Schema additions:
      - 4 new asset-kind seeds: `skill.driving`,
        `credential.drivers-license` (VC-typed, match-only),
        `tool.vehicle.bicycle`, `tool.vehicle.cargo-bike`.
        Catalog now ~55 nodes.

    Schema axes exercised (no schema changes required):
      - `blackstar` surface — last unused Surface enum value.
        Catalog now covers 4/4 surfaces.
      - `tool.vehicle.*` depth-2 wildcard — fourth wildcard root
        and the first below the top level. Proves the matcher
        works regardless of taxonomy depth. Orthogonality test
        asserts this as a structural fact (and that the max-depth
        among roots is 2).
      - Mixed cash + time-bank settlement (`usdc` + `hours`
        coexisting on one vertical). The first manifest where the
        cash leg and the time-bank leg run side by side; the five
        earlier manifests used one or the other but not both.
      - Second manifest on the `workshop` playbook (repair-cafe is
        the first). Differs on (surface, governance) — the
        `(playbook, governance, surface)` uniqueness check still
        passes.
      - Second manifest with `match-only`-defaulted credential
        (after childcare's `credential.cpr-certified` /
        `credential.background-check`). Driver's license is PII
        even when government-issued.

    Tests (8 new):
      - 6 matcher tests: happy-path, depth-2 wildcard expansion
        across bicycle + cargo-bike + truck (parent), min_count: 2
        enforcement, dispatcher hours_per_week_min: 10
        enforcement, candidate-operator semantics (couriers ARE
        operators here because skill.driving uses role `operator`;
        the matcher's role gating works as advertised).
      - 2 orthogonality blocks: per-manifest invariants for
        courier-collective, and "workshop playbook hosts two
        manifests" multi-tenancy proof.

    Catalog-coverage assertions strengthened:
      - "≥3 distinct surfaces" → "covers every Surface enum value"
        (4/4: commerce, threshold, refrain, blackstar)
      - Wildcard-roots set equality: now
        {tool, skill.repair, skill.creative, tool.vehicle}; max
        depth is 2 (asserted directly).

    237 asset-graph unit tests passing (was 229). Typecheck clean.

    Open follow-ups (all workflow-side):
      - Per-delivery settlement chain (USDC + HRS + KARMA emission
        on a single delivery-completion event).
      - Dispatch routing engine (logistics; outside asset-graph
        schema).
      - Commercial-bond / insurance credentials (real couriers
        carry these; v0.1's `credential.*` category supports
        adding them when needed).

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
