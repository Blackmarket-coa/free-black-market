/**
 * Plant Network — Live-plant shipping profile seed (Section 10).
 *
 * Run once:  npx medusa exec src/scripts/seed-plant-shipping-profiles.ts
 *
 * Current state: shipping options are seeded generically via
 * `scripts/seed/seed-functions.ts` (MedusaJS `createShippingOptionsWorkflow` +
 * MercurJS SELLER_SHIPPING_PROFILE_LINK). There is no dedicated live-plant
 * profile (USPS Priority only, winter heat-pack, restricted-state blocking,
 * max 3-day transit). This script defines those profiles and is the place to
 * wire them via the existing workflow.
 */

import type { ExecArgs } from "@medusajs/framework/types"

export const PLANT_SHIPPING_PROFILES = [
  {
    name: "Live Plants — USPS Priority",
    type: "custom",
    metadata: {
      carrier: "USPS",
      service: "Priority Mail",
      max_transit_days: 3,
      requires_heat_pack_months: [11, 12, 1, 2], // Nov–Feb
      heat_pack_surcharge_cents: 250,
      restricted_states: ["CA", "AZ", "HI"],
      requires_phyto_cert_states: ["CA", "AZ", "HI", "TX"],
    },
  },
  {
    name: "Dried Products & Tinctures — Standard",
    type: "default",
    metadata: {
      carrier: "USPS",
      service: "Ground Advantage",
      max_transit_days: 7,
      restricted_states: [],
    },
  },
  {
    name: "Plug Trays — Wholesale Ground",
    type: "custom",
    metadata: {
      carrier: "UPS",
      service: "Ground",
      max_transit_days: 5,
      min_order_value_cents: 20000, // $200 minimum
      restricted_states: ["CA", "AZ", "HI"],
    },
  },
  {
    name: "Digital Products — No Shipping",
    type: "digital",
    metadata: { delivery: "download_link" },
  },
] as const

/**
 * TODO: Seed the profiles above using the EXISTING fulfillment workflow used in
 * `scripts/seed/seed-functions.ts` (createShippingProfilesWorkflow /
 * createShippingOptionsWorkflow), then attach each profile to the matching
 * products. Idempotent: skip profiles that already exist by name.
 */
export default async function seedPlantShippingProfiles(_args: ExecArgs) {
  throw new Error("TODO: seedPlantShippingProfiles not implemented")
}
