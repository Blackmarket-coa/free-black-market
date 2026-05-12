# Handoff — asset-graph v0

Last touched: 2026-05-13. Branch: `claude/asset-graph-commons-dvAeT`.
Six commits beyond `main` after the composition-layer merge:

- `4875640` feat(asset-graph): v0 schema + nursery + tool-library reference manifests
- `8bc7694` feat(asset-graph): repair-cafe reference manifest (v0 third vertical)
- `9c32064` feat(asset-graph): persistence migration + catalog seeder
- `42bef9d` feat(hawala-ledger): rails registry + HRS + KARMA + karma_event model
- `37de7b9` feat(asset-graph): matching engine — proposal generator
- (pending) feat(asset-graph): W3C Verifiable Credential payload validation

All pushed to `origin/claude/asset-graph-commons-dvAeT`. No PR open.

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
