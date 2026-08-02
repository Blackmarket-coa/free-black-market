import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import { VENDOR_PLAN_CATALOG } from "../modules/vendor-plan/catalog"

/**
 * Seed the vendor billing-plan catalog. Idempotent: upserts by `code`.
 * Mirrors seed-plugins.ts.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-vendor-plans.ts
 */
export default async function seedVendorPlans({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const plans: any = container.resolve(VENDOR_PLAN_MODULE)

  let created = 0
  let updated = 0

  for (const p of VENDOR_PLAN_CATALOG) {
    const payload = {
      code: p.code,
      display_name: p.display_name,
      description: p.description,
      price_amount: p.price_amount,
      currency_code: p.currency_code,
      interval: p.interval,
      platform_fee_percent: p.platform_fee_percent,
      trial_days: p.trial_days,
      is_active: p.is_active,
      is_public: p.is_public,
      display_order: p.display_order,
      feature_keys: p.feature_keys,
    }

    const [existing] = await plans.listVendorPlans({ code: p.code })
    if (existing) {
      await plans.updateVendorPlans({ id: existing.id, ...payload })
      updated++
    } else {
      await plans.createVendorPlans(payload)
      created++
    }
  }

  logger.info(
    `[seed-vendor-plans] ${created} created, ${updated} updated (${VENDOR_PLAN_CATALOG.length} in catalog)`
  )
}
