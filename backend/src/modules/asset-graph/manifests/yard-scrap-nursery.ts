import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Yard-Scrap Nursery (v0 reference manifest)
 *
 * Closed-loop urban-agriculture node. Households contribute yard scraps
 * (declared via `output-capacity.yard-scrap`) in exchange for Coalition
 * Credits; an operator processes them into compost, vermicast, and
 * plant plugs that flow to FBM retail (USDC / USD via Stripe ACH edge)
 * and to member-rate Commons sales.
 *
 * Plays on the `grove` playbook: "Mutual-aid co-op with internal scrip
 * and sliding scale." Sits on the `commerce` surface (FBM proper).
 *
 * Orthogonality role for v0: this manifest contributes recurring
 * production output, individual governance, and the CCR/USDC/USD
 * settlement triangle. Paired with the tool-library manifest, the two
 * exercise five different lifecycles, four different settlement rails,
 * and two different surfaces, which is the v0 test that the schema
 * generalizes.
 */
export const YARD_SCRAP_NURSERY_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "yard-scrap-nursery",
    version: "0.1.0",
    display_name: "Yard-Scrap Nursery",
    description:
      "A neighborhood-scale closed-loop nursery: households trade yard scraps for Coalition Credits; an operator turns them into compost, vermicast, and plant plugs sold via FBM and at member-rate to the Commons.",
    required_asset_kinds: [
      {
        kind_slug: "land.yard.residential",
        role: "host",
        min_count: 1,
        constraints: { acreage_min: 0.25 },
        lifecycle: "durable-commitment",
      },
      {
        kind_slug: "skill.horticulture",
        role: "operator",
        min_count: 1,
      },
      {
        kind_slug: "tool.vehicle.truck",
        role: "operator-or-shared",
        min_count: 1,
      },
      {
        kind_slug: "time.recurring",
        role: "operator",
        min_count: 1,
        constraints: { hours_per_week_min: 20 },
        lifecycle: "recurring",
      },
      {
        kind_slug: "output-capacity.yard-scrap",
        role: "contributor",
        min_count: 1,
        lifecycle: "recurring",
      },
      {
        kind_slug: "output-capacity.compost",
        role: "operator-produced",
        min_count: 1,
        lifecycle: "recurring",
      },
      {
        kind_slug: "output-capacity.vermicast",
        role: "operator-produced",
        min_count: 1,
        lifecycle: "recurring",
      },
      {
        kind_slug: "output-capacity.plant-plug",
        role: "operator-produced",
        min_count: 1,
        lifecycle: "recurring",
      },
      {
        kind_slug: "skill.installation",
        role: "operator",
        min_count: 1,
        optional: true,
      },
    ],
    settlement_rails: ["ccr", "usdc", "usd", "gift"],
    playbook_slug: "grove",
    listing_type_slugs: ["physical_product", "bookable", "recurring"],
    governance_model: "individual",
    sensitivity_floor: "member-visible",
    surface: "commerce",
  })
