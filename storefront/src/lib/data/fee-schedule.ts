"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"
// Lives in a plain module: a `"use server"` file may export only async
// functions, so a constant here fails `next build`.
import { FALLBACK_DEFAULT_FEE_PERCENT } from "../constants/fees"

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
