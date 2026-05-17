import { ProjectManifestSchema, type ProjectManifestRecipe } from "./types"

/**
 * Courier Collective (v0 reference manifest — blackstar vertical)
 *
 * A worker-owned delivery cooperative. Couriers commit weekly hours
 * + their own vehicle + a driver's license + a generic driving
 * skill; a dispatcher coordinates pickups and deliveries. Customers
 * pay in USDC; couriers accrue time-bank HRS alongside their cash
 * earnings; KARMA accrues on completed runs (rider/recipient
 * ratings); GIFT covers free deliveries to mutual-aid recipients
 * (Threshold members).
 *
 * Plays on the `workshop` playbook (worker co-op with sociocratic
 * circles, rotating roles — the right shape for a couriers-own-the-
 * collective vertical). Sits on the `blackstar` surface — the
 * delivery/mobility surface that v0/v0.1 had named but no manifest
 * had landed on.
 *
 * Orthogonality role: this manifest contributes the `blackstar`
 * surface (last unused Surface enum value), `tool.vehicle.*` as a
 * fourth wildcard root (and the first at depth 2 — proves the
 * wildcard matcher works regardless of taxonomy depth), and the
 * first manifest where a worker-cooperative governance pairs with
 * a paid-in-USDC + time-bank-HRS mixed-rail settlement model.
 *
 * Combined with the five earlier manifests, the catalog now
 * exercises **every value** in all four enums the manifest schema
 * cares about: Lifecycle, SettlementRail, GovernanceModel, AND
 * Surface. Full coverage across the four schema axes.
 */
export const COURIER_COLLECTIVE_MANIFEST: ProjectManifestRecipe =
  ProjectManifestSchema.parse({
    slug: "courier-collective",
    version: "0.1.0",
    display_name: "Courier Collective",
    description:
      "A worker-owned delivery cooperative. Couriers commit weekly hours + a vehicle + a driver's license; a dispatcher coordinates pickups and deliveries. Customers pay in USDC; couriers accrue time-bank hours alongside cash earnings. Karma signals completed runs; gift covers free deliveries to mutual-aid recipients.",
    required_asset_kinds: [
      // The driving skill itself — at least two couriers so the
      // dispatch graph has resilience to a single courier's
      // unavailability.
      {
        kind_slug: "skill.driving",
        role: "operator",
        min_count: 2,
        lifecycle: "durable-commitment",
      },
      // Every courier needs a valid driver's license (or jurisdiction-
      // equivalent for bicycles, where states/cities permit). VC body
      // on the attestation; sensitivity match-only by default
      // (driver's license is PII).
      {
        kind_slug: "credential.drivers-license",
        role: "operator",
        min_count: 2,
        lifecycle: "durable-commitment",
      },
      // Depth-2 wildcard: any tool.vehicle subkind (truck, bicycle,
      // cargo-bike, ...). Proves the wildcard mechanism works
      // regardless of taxonomy depth.
      {
        kind_slug: "tool.vehicle.*",
        role: "operator-or-shared",
        min_count: 2,
        lifecycle: "durable-commitment",
      },
      // Weekly courier shifts.
      {
        kind_slug: "time.recurring",
        role: "operator",
        min_count: 2,
        constraints: { hours_per_week_min: 5 },
        lifecycle: "recurring",
      },
      // Dispatcher.
      {
        kind_slug: "time.coordinator",
        role: "coordinator",
        min_count: 1,
        constraints: { hours_per_week_min: 10 },
        lifecycle: "recurring",
      },
    ],
    settlement_rails: ["usdc", "hours", "karma", "gift"],
    playbook_slug: "workshop",
    listing_type_slugs: ["bookable", "recurring"],
    governance_model: "collective",
    sensitivity_floor: "member-visible",
    surface: "blackstar",
  })
