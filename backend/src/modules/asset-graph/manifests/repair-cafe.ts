import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Repair Café (v0 reference manifest)
 *
 * Periodic neighborhood event where volunteer fixers diagnose and repair
 * household items brought in by the public. Fixers contribute event-shift
 * time and specialized skills (electronics, textile, mechanical); a
 * coordinator runs intake and scheduling; a venue hosts. Settlement is
 * gift-first with karma accrual; no money changes hands at the event.
 *
 * Plays on the `workshop` playbook: "Worker co-op with sociocratic
 * circles, rotating roles, patronage refunds." Sits on the `threshold`
 * surface (same as tool library — Threshold hosts multiple mutual-aid
 * verticals).
 *
 * Orthogonality role for v0: this manifest contributes a wildcard on
 * `skill.repair.*` (proving wildcards aren't load-bearing on the `tool`
 * category specifically), the `perishable` and `one-time` lifecycles
 * (neither nursery nor tool library exercise these), `consensus`
 * governance, the `public` sensitivity floor, the `workshop` playbook,
 * the `event` listing-type, the `client` role for consumer-intake
 * declarations, and the `artifact.broken-item` taxonomy node (a
 * structurally novel "consumer declares a problem to be solved"
 * declaration shape, distinct from the producer-side declarations the
 * other two manifests rely on).
 *
 * Combined with the nursery and tool library, the catalog now covers
 * every value in the `Lifecycle` and `SettlementRail` enums — the
 * strongest available structural proof that the schema generalizes.
 */
export const REPAIR_CAFE_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "repair-cafe",
    version: "0.1.0",
    display_name: "Repair Café",
    description:
      "A recurring neighborhood event where volunteer fixers diagnose and repair household items the public brings in. Skill-matched intake, event-shift time, gift settlement with karma accrual, consensus-governed by the fixer collective.",
    required_asset_kinds: [
      {
        kind_slug: "skill.repair.*",
        role: "fixer",
        min_count: 1,
        lifecycle: "durable-commitment",
      },
      {
        kind_slug: "time.event-shift",
        role: "fixer",
        min_count: 1,
        constraints: { hours_min: 2 },
        lifecycle: "perishable",
      },
      {
        kind_slug: "space.event-venue",
        role: "host",
        min_count: 1,
        constraints: { accessible: true },
        lifecycle: "durable-commitment",
      },
      {
        kind_slug: "time.coordinator",
        role: "coordinator",
        min_count: 1,
        constraints: { hours_per_week_min: 2 },
        lifecycle: "recurring",
      },
      {
        kind_slug: "artifact.broken-item",
        role: "client",
        min_count: 1,
        lifecycle: "one-time",
      },
    ],
    settlement_rails: ["karma", "gift"],
    playbook_slug: "workshop",
    listing_type_slugs: ["event", "bookable"],
    governance_model: "consensus",
    sensitivity_floor: "public",
    surface: "threshold",
  })
