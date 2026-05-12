import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Tool Library (v0 reference manifest)
 *
 * Member-side lending network. Members declare tools they're willing to
 * lend (matched via the `tool.*` wildcard); borrowers reserve a slot;
 * loans settle in time-banked hours and Karma, with Coalition Credits
 * covering lost-tool replacement and gift covering low-value
 * consumables. A librarian role coordinates returns and dispute
 * resolution.
 *
 * Plays on the `commons` playbook: "Multi-stakeholder co-op: producers
 * + workers + consumers + supporters." Sits on the `threshold` surface
 * (per docs/COMPOSITION_LAYER.md, tool libraries are an explicit
 * Threshold use case).
 *
 * Orthogonality role for v0: this manifest contributes
 * exhaustible-borrow-return lifecycle, collective governance, hours +
 * karma settlement (the time-banked rails), member-internal output
 * (nothing exits to retail), and a credential-typed declaration
 * (`credential.trust-score`) at the most restrictive sensitivity tier.
 * It tests dimensions the nursery cannot.
 *
 * The `tool.*` wildcard on the lender slot is the test that the
 * taxonomy supports hierarchical matching. If a future schema change
 * breaks wildcards, this manifest stops parsing.
 */
export const TOOL_LIBRARY_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "tool-library",
    version: "0.1.0",
    display_name: "Tool Library",
    description:
      "A neighborhood lending pool. Members declare tools they'll lend; borrowers reserve slots; loans settle in time-banked hours and Karma; lost-tool replacements settle in Coalition Credits. Coordinated by a member librarian.",
    required_asset_kinds: [
      {
        kind_slug: "tool.*",
        role: "lender",
        min_count: 1,
        lifecycle: "exhaustible-borrow-return",
      },
      {
        kind_slug: "space.storage",
        role: "library-node",
        min_count: 0,
        optional: true,
      },
      {
        kind_slug: "time.coordinator",
        role: "librarian",
        min_count: 1,
        lifecycle: "recurring",
      },
      {
        kind_slug: "credential.trust-score",
        role: "borrower-side",
        min_count: 1,
        lifecycle: "durable-commitment",
      },
    ],
    settlement_rails: ["hours", "karma", "ccr", "gift"],
    playbook_slug: "commons",
    listing_type_slugs: ["bookable"],
    governance_model: "collective",
    sensitivity_floor: "member-visible",
    surface: "threshold",
  })
