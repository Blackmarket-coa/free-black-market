import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Creator Bounty Pool (v0 reference manifest — vote-weighted vertical)
 *
 * A creator commits to producing a piece of work — a story, an
 * album, a series of paintings — funded by supporter pledges. Each
 * supporter declares a `capital.bounty-contribution` pledge. The
 * pledge amount denominates the supporter's vote weight when the
 * manifest's `governance_model: vote-weighted` resolves which work
 * the creator funds next (a stretch-goal model: every pledge counts
 * for funding, and bigger pledges have proportionally more say in
 * which of the creator's queued works gets produced first).
 *
 * Plays on the `atelier` playbook (small affinity group, flat
 * consensus). Sits on the `refrain` surface — the creator-bounty
 * surface that v0/v0.1 had named but no manifest had landed on.
 *
 * Orthogonality role: this manifest contributes the
 * `vote-weighted` governance model (last unused governance enum
 * value — the catalog now exercises all four), the `refrain`
 * surface (third distinct surface; `blackstar` still unused), the
 * `atelier` playbook (fourth distinct playbook), the `capital`
 * asset category (first concrete capital kind on the substrate),
 * and a third wildcard root (`skill.creative.*`) — proving the
 * wildcard matcher is general across multiple category roots.
 *
 * Combined with the four earlier manifests, the catalog now
 * exercises every value in the `Lifecycle`, `SettlementRail`, and
 * `GovernanceModel` enums.
 */
export const CREATOR_BOUNTY_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "creator-bounty-pool",
    version: "0.1.0",
    display_name: "Creator Bounty Pool",
    description:
      "A creator commits to producing a piece of work funded by supporter pledges. Pledge amounts weight supporters' votes on which queued work the creator funds next. Settled in USDC + karma + gift. Vote-weighted governance.",
    required_asset_kinds: [
      // The creator — at least one skill in the creative tree.
      {
        kind_slug: "skill.creative.*",
        role: "operator",
        min_count: 1,
        lifecycle: "durable-commitment",
      },
      // The work the creator commits to deliver. One commitment per
      // bounty cycle; lifecycle is one-time (the deliverable ships
      // and the declaration is discharged).
      {
        kind_slug: "output-capacity.creative-work",
        role: "operator-produced",
        min_count: 1,
        lifecycle: "one-time",
      },
      // The supporters — minimum three so the vote-weighted
      // resolution has more than a binary signal.
      {
        kind_slug: "capital.bounty-contribution",
        role: "contributor",
        min_count: 3,
        lifecycle: "one-time",
      },
      // The curator — schedules deliveries, runs the vote tally.
      {
        kind_slug: "time.coordinator",
        role: "coordinator",
        min_count: 1,
        constraints: { hours_per_week_min: 2 },
        lifecycle: "recurring",
      },
      // Optional VC-typed creator identity. Supporters can choose
      // to require this; the manifest doesn't force it (anonymous
      // bounty pools are valid).
      {
        kind_slug: "credential.creator-verification",
        role: "operator",
        min_count: 0,
        optional: true,
        lifecycle: "durable-commitment",
      },
    ],
    settlement_rails: ["usdc", "karma", "gift"],
    playbook_slug: "atelier",
    listing_type_slugs: ["campaign", "digital"],
    governance_model: "vote-weighted",
    sensitivity_floor: "public",
    surface: "refrain",
  })
