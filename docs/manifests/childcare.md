# Manifest: Childcare Co-op (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `childcare-coop` |
| Playbook | `commons` (multi-stakeholder co-op: producers + workers + consumers + supporters) |
| Listing types | `bookable`, `recurring` |
| Surface | `threshold` (mutual-aid) |
| Governance | `consensus` |
| Sensitivity floor | `match-only` |
| Settlement rails | `hours`, `karma`, `gift` |

## Status

Draftable but not fully operational on v0.1. The cluster-3 sanity-check
appendix in `docs/ASSET_GRAPH.md` identified three v1 dependencies
before a childcare manifest can run end-to-end:

1. ✓ **W3C Verifiable Credential body validation** — landed in v0.1
   (`backend/src/modules/asset-graph/attestations/vc.ts`). The
   `credential.cpr-certified` and `credential.background-check`
   declarations can carry real VC payloads on their attestations,
   and `createAttestationWithVC` validates them at write time.
2. ✗ **Minor-data sensitivity enforcement.** v0 stores
   `sensitivity_tier` on each declaration and `sensitivity_floor`
   on the manifest; this manifest sets the floor to `match-only`
   (the most restrictive value). Cryptographic enforcement — keeping
   the data redacted in lists and only revealing it inside a matched
   project context — requires the Blackout E2EE workstream and is
   not yet wired.
3. ✗ **Consensus governance proposal rounds.** The
   `governance_model: consensus` enum value records intent; the
   proposal-and-consent-round workflow that operationalizes it
   lives in Governance v2.
4. ✗ (bonus) **Background-check revocation pull
   (BitstringStatusList).** A revoked VC currently still parses as
   structurally valid; a v1 revocation check should gate it before
   a project instance deploys.

The manifest is therefore valid **structurally** — the schema
generalizes to care-economy verticals without changes — but
operating an actual childcare co-op requires the v1 work above. This
is the discipline the v0 thesis aims for: the substrate shape is
proven correct by the manifest fitting; operational depth lands one
vertical at a time.

## The project

Rotating-caregiver childcare among a small group of families.
Three-to-five families share weekly hours; one family's
childproofed home hosts; a coordinator schedules. Care is settled
in time-banked HRS (one hour caregiving ≈ one hour received) with
KARMA accrual on completion, and GIFT as the constitutional rail
when families decline reciprocation. Money does not change hands;
the `settlement_rails: ["hours", "karma", "gift"]` is the
no-cash-flows shape.

## Required asset declarations

| Slug | Role | Min count | Optional? | Constraints |
| --- | --- | --- | --- | --- |
| `skill.childcare` | caregiver | 3 | no | — |
| `time.recurring` | caregiver | 3 | no | `hours_per_week_min: 4` |
| `credential.cpr-certified` | caregiver | 1 | no | — (VC body on attestation) |
| `credential.background-check` | caregiver | 3 | no | — (VC body on attestation) |
| `space.home` | host | 1 | no | `childproofed: true` |
| `time.coordinator` | coordinator | 1 | no | `hours_per_week_min: 5` |
| `skill.peer-support` | caregiver | 0 | yes | — (lived-experience support) |

## What this manifest exercises in v0.1

- **Multi-count slots** (`min_count: 3` for caregivers + background
  checks). The matcher already supported it; childcare is the first
  manifest to stress it. The match shape is "find at least N
  declarations of kind K," not "find one."
- **Boolean attribute constraint** (`childproofed: true` on
  `space.home`). The constraint vocabulary already handles `_min` /
  `_max` for numerics and exact-match for booleans; the childcare
  manifest is the cleanest exercise of the boolean path.
- **`caregiver` role**, which the manifest adds to `ManifestRole`.
  Caregivers are intentionally NOT in `OPERATOR_LIKE_ROLES` — the
  matcher treats them as participants (like fixers in the repair
  café and clients in any consumer-intake vertical). The
  coordinator and host are the deployment anchors.
- **`match-only` sensitivity floor**. No other v0.1 manifest uses
  this as the floor; the credential.trust-score declaration in the
  tool library defaults to it, but the tool library's manifest floor
  is `member-visible`. Childcare is the first manifest where every
  declaration written under it is automatically promoted to
  `match-only` by floor enforcement (once the Blackout E2EE work
  lands; v0.1 stores the tier without enforcing).
- **The credential.* category with VC-typed attestations**. The
  `credential.cpr-certified` and `credential.background-check`
  slots are concrete leaves whose attestation rows carry a real
  W3C Verifiable Credential body (parsed and validated by
  `attestations/vc.ts`). v0.1 is the first manifest to point at
  this plumbing for its actual operational use case.
- **The `commons` playbook in a second manifest**. Tool library
  was the first; childcare is the second. The orthogonality test
  explicitly allows this: two manifests on the same playbook must
  differ on at least one of (playbook, governance, surface). They
  do — collective vs. consensus governance.

## Settlement

- **Hours** is the core rail. A caregiver providing two hours of
  care accrues two HRS; the recipient family's balance decreases
  correspondingly. The reconciler routes these through
  `hawala-ledger.createTransfer` between the members' `TIME_BANK`
  accounts with `reference_type: TIMEBANK_LOAN` (or TIMEBANK_RETURN
  for reciprocal care).
- **Karma** accrues to caregivers on each completed shift, surfacing
  reputation and the anti-hoarding signal `docs/COMPOSITION_LAYER.md`
  describes. Routed through `createKarmaEvents` (karma is
  unilateral).
- **Gift** when families decline reciprocation (chronic illness,
  loss-of-job, hard moments). Audit-only; no balance moves.

No `usd`, `usdc`, or `ccr` — keeping money out of childcare is part
of what makes consensus governance tractable, the same way it does
for the repair café.

## Governance

`consensus`. Real childcare co-ops require consent rounds for:

- New-family admission (the big one — every existing family must
  consent to adding another)
- Removal of a caregiver (rare but heavy)
- Major policy changes (e.g., changing pickup/dropoff windows)

The `consensus` enum value records intent. The proposal+consent-
round workflow that operationalizes it is Governance v2.

## Open dependencies

- **Minor-data sensitivity enforcement.** v0.1 records the
  `match-only` floor; v1 must enforce it in lists, queries, and
  cross-member discovery paths. Blocking dep for going live.
- **Consensus governance proposal rounds.** Same as above —
  schema records intent, workflow is Governance v2.
- **Background-check revocation pull.** The
  `credential.background-check` VC has a validity window the
  attestation honors, but if a clearance is revoked mid-window the
  childcare manifest won't notice. v1 should add a
  BitstringStatusList check before an instance accepts a proposal.
- **Lived-experience-attestation primitive for `skill.peer-support`.**
  Who can vouch for a peer-support skill? The current peer-vouched
  attestation tier is structurally there but doesn't capture the
  cluster-3 norms about who's qualified to attest. Governance v2.

## Why this is the right v0.1 fourth manifest

Two reasons.

First, the cluster-3 sanity-check appendix has been a thinking aid
since v0; now that the VC plumbing landed, writing the manifest
concretely is the discipline that proves the schema is what it
claims to be. Three of the four cluster-3 v1 deps surfaced naturally
when writing the manifest; the fourth (revocation pull) surfaced in
review. Each documents what v1 has to add.

Second, it stresses three schema axes none of the first three
manifests fully exercise: multi-count slots, boolean attribute
constraints, and VC-typed credentials. The substrate fit them all
without growing new top-level concepts — the strongest available
proof that the v0 schema generalizes beyond the verticals it was
originally tuned for.
