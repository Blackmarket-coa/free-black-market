"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"

export type FeeSchedulePlan = {
  code: string
  display_name: string
  description: string
  price_amount: number
  currency_code: string
  interval: "month" | "year" | "none"
  platform_fee_percent: number
  is_default: boolean
}

export type FeeSchedule = {
  default_plan_code: string
  default_fee_percent: number
  plans: FeeSchedulePlan[]
}

/**
 * The rate quoted if the backend is unreachable. Matches
 * `PLATFORM_DEFAULT_FEE_PERCENT` in `backend/src/modules/vendor-plan/catalog.ts`
 * and is asserted against the live route by
 * `src/lib/__tests__/fee-schedule.spec.ts`.
 *
 * A fallback is the right call here rather than hiding the number: the flat fee
 * is the platform's central promise, and a page that renders "we take —%"
 * during a backend blip is worse than one that renders the rate we have charged
 * since launch.
 */
export const FALLBACK_DEFAULT_FEE_PERCENT = 3

/**
 * Fetch the published commission schedule from `/store/fee-schedule`.
 *
 * Cached for an hour: the plan ladder changes on the order of never, and the
 * transparency page is a linkable, shareable artifact that should not put a
 * request on the backend for every visitor.
 */
export async function getFeeSchedule(): Promise<FeeSchedule> {
  try {
    return await medusaFetch<FeeSchedule>("/store/fee-schedule", {
      method: "GET",
      next: { revalidate: 3600 },
    })
  } catch (error) {
    logger.error("[getFeeSchedule] falling back to default fee percent:", error)
    return {
      default_plan_code: "free",
      default_fee_percent: FALLBACK_DEFAULT_FEE_PERCENT,
      plans: [],
    }
  }
}
