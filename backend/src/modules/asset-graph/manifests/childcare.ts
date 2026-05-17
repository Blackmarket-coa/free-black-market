import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Childcare Co-op (v0 reference manifest — cluster-3 stress test)
 *
 * Rotating-caregiver childcare among a small group of families. A
 * coordinator schedules; a host's home is the venue; multiple
 * caregivers each contribute hours per week. Care is settled in
 * time-bank HRS (one hour caregiving ≈ one hour received) with KARMA
 * accrual on completion. Money does not change hands.
 *
 * Plays on the `commons` playbook (multi-stakeholder co-op:
 * producers + workers + consumers + supporters). Sits on the
 * `threshold` surface (mutual-aid).
 *
 * STATUS — DRAFTABLE BUT NOT FULLY OPERATIONAL ON v0.1.
 *
 * The cluster-3 sanity-check appendix in docs/ASSET_GRAPH.md
 * identified three v1 deps before a childcare manifest can run end-
 * to-end:
 *
 *   1. W3C Verifiable Credential body validation — LANDED in v0.1
 *      (attestations/vc.ts). credential.cpr-certified and
 *      credential.background-check declarations can now carry real
 *      VCs.
 *
 *   2. minor-data sensitivity enforcement — DEFERRED. v0 stores the
 *      sensitivity_tier on each declaration; cryptographic
 *      enforcement (room-scoped / match-only redaction) requires the
 *      Blackout E2EE workstream. This manifest sets
 *      `sensitivity_floor: match-only` so the schema records intent
 *      even though the crypto isn't enforced yet.
 *
 *   3. consensus governance proposal-rounds — DEFERRED. The enum
 *      value exists; the proposal+consent-round workflow that
 *      operationalizes it lives in Governance v2.
 *
 *   bonus 4. Background-check revocation pull (BitstringStatusList)
 *           — DEFERRED. A revoked credential currently still passes
 *           the VC schema; a v1 revocation check should gate it
 *           before a project instance deploys.
 *
 * The manifest is therefore valid structurally — schema generalizes
 * to care-economy verticals without changes — but operating an
 * actual childcare co-op on it requires the v1 work above. This is
 * the discipline the v0 thesis aims for: the substrate shape is
 * proven correct by the manifest fitting; operational depth lands one
 * vertical at a time.
 *
 * Orthogonality role: this manifest contributes the `match-only`
 * sensitivity floor (no other v0 manifest uses it as the floor),
 * adds the `caregiver` role to the ManifestRole vocabulary,
 * exercises the credential.* category for two distinct credential
 * subkinds (CPR + background-check), and uses the `space.home`
 * declaration with the `childproofed` boolean attribute constraint —
 * the v0 constraint vocabulary applied to a boolean. Combined with
 * the three existing manifests, the catalog covers four playbooks
 * (grove, commons, workshop) — commons appears in two manifests now,
 * which the orthogonality test allows because the pairs differ on
 * other axes.
 */
export const CHILDCARE_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "childcare-coop",
    version: "0.1.0",
    display_name: "Childcare Co-op",
    description:
      "Rotating-caregiver childcare among a small group of families. Caregivers contribute weekly hours; a coordinator schedules; one family's home hosts. Settled in time-bank hours with karma accrual. Cluster-3 stress test — structurally valid on v0.1, operationally pending minor-data sensitivity crypto + consensus governance proposal rounds.",
    required_asset_kinds: [
      // The rotating caregivers — minimum three to keep the rotation viable.
      {
        kind_slug: "skill.childcare",
        role: "caregiver",
        min_count: 3,
        lifecycle: "durable-commitment",
      },
      {
        kind_slug: "time.recurring",
        role: "caregiver",
        min_count: 3,
        constraints: { hours_per_week_min: 4 },
        lifecycle: "recurring",
      },
      // CPR-certified caregiver — at least one available per shift.
      {
        kind_slug: "credential.cpr-certified",
        role: "caregiver",
        min_count: 1,
        lifecycle: "durable-commitment",
      },
      // Background check — every caregiver. Minor-data sensitivity:
      // the credential declaration sits at the most restrictive tier
      // (per AssetKind defaults). Crypto enforcement lands in v1.
      {
        kind_slug: "credential.background-check",
        role: "caregiver",
        min_count: 3,
        lifecycle: "durable-commitment",
      },
      // Where care happens. Constraint enforces the home is
      // childproofed. v0 constraint vocabulary covers boolean exact
      // match.
      {
        kind_slug: "space.home",
        role: "host",
        min_count: 1,
        constraints: { childproofed: true },
        lifecycle: "durable-commitment",
      },
      // Scheduling + intake. Recurring weekly coordinator time.
      {
        kind_slug: "time.coordinator",
        role: "coordinator",
        min_count: 1,
        constraints: { hours_per_week_min: 5 },
        lifecycle: "recurring",
      },
      // Lived-experience peer support — optional. Adds a v1 question:
      // who can vouch for a peer-support skill? The lived-experience-
      // attestation primitive is a Governance v2 concern.
      {
        kind_slug: "skill.peer-support",
        role: "caregiver",
        min_count: 0,
        optional: true,
        lifecycle: "durable-commitment",
      },
    ],
    settlement_rails: ["hours", "karma", "gift"],
    playbook_slug: "commons",
    listing_type_slugs: ["bookable", "recurring"],
    governance_model: "consensus",
    sensitivity_floor: "match-only",
    surface: "threshold",
  })
