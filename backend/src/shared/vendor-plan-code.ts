import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"

const log = createLogger("shared/vendor-plan-code")

/**
 * The plan a seller is effectively on (a canceled assignment reads as the
 * default plan) plus any scheduled change, for deciding which add-on packs to
 * offer (`addonOfferedForPurchase`). Null when the plan cannot be read.
 *
 * The plan's OWN code, deliberately not the gate's entitlement union: callers
 * use it to decide whether the plan already covers an add-on, and the union
 * would include the add-on itself once owned. Never throws — the add-on
 * routes degrade to their pre-flag behaviour on null.
 */
export async function addonPlanContextOrNull(
  container: MedusaContainer,
  sellerId: string
): Promise<{ plan_code: string; pending_plan_code: string | null } | null> {
  try {
    const plans = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)
    const plan_code = await plans.getEffectivePlanCode(sellerId)
    const assignment = await plans.getAssignment(sellerId)
    return {
      plan_code,
      pending_plan_code:
        (assignment?.pending_plan_code as string | null | undefined) ?? null,
    }
  } catch (err) {
    log.warn(`[plan] plan context read failed for ${sellerId}`, err)
    return null
  }
}
