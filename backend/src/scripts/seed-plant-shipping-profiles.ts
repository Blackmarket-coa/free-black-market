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
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingProfilesWorkflow } from "@medusajs/medusa/core-flows"

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
 * Idempotently seed the live-plant shipping profiles via the same workflow used
 * by `scripts/seed/seed-functions.ts`. Profiles already present (by name) are
 * skipped, so this is safe to re-run.
 *
 * Attaching options/products to each profile (carrier rules, prices) is left to
 * the admin / a follow-up migration — `createShippingOptionsWorkflow` needs a
 * service zone + region which are environment-specific.
 */
export default async function seedPlantShippingProfiles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fulfillment = container.resolve(Modules.FULFILLMENT) as {
    listShippingProfiles: (filters: Record<string, unknown>) => Promise<Array<{ name: string }>>
  }

  const existing = await fulfillment.listShippingProfiles({})
  const existingNames = new Set(existing.map((p) => p.name))

  const toCreate = PLANT_SHIPPING_PROFILES.filter((p) => !existingNames.has(p.name))

  if (toCreate.length === 0) {
    logger.info("[seed-plant-shipping-profiles] all profiles already present; nothing to do")
    return
  }

  const { result } = await createShippingProfilesWorkflow(container).run({
    input: {
      data: toCreate.map((p) => ({
        name: p.name,
        type: p.type,
        metadata: p.metadata as Record<string, unknown>,
      })),
    },
  })

  logger.info(
    `[seed-plant-shipping-profiles] created ${result.length} profile(s): ${toCreate
      .map((p) => p.name)
      .join(", ")}`
  )
}
