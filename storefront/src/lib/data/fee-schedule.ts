"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"
// Lives in a plain module: a `"use server"` file may export only async
// functions, so a constant here fails `next build`.
import { FALLBACK_DEFAULT_FEE_PERCENT } from "../constants/fees"
import { phase1ModuleFlags } from "../feature-flags"

export type FeeSchedulePlan = {
  code: string
  display_name: string
  description: string
  price_amount: number
  currency_code: string
  interval: "month" | "year" | "none"
  platform_fee_percent: number
  is_default: boolean
  /**
   * Free-trial length on this plan. Optional so an older backend that does not
   * send it still type-checks; absent reads as "no trial stated".
   */
  trial_days?: number
}

/**
 * How card processing is handled, sent by `/store/fee-schedule` ONLY while the
 * API's FF_FEE_FIRST_SPLIT_V1 is on (Black Mask F6): the estimate comes off
 * the sale first and the coalition fee is taken on what is left. Absent means
 * today's model, and every page renders today's wording. `percent` /
 * `fixed_cents` are null when the backend could not read its own config.
 */
export type FeeScheduleProcessing = {
  model: "fee_first"
  percent: number | null
  fixed_cents: number | null
}

/** Fee-first, with no figures this module could check (pages quote the documented default). */
const FEE_FIRST_WITHOUT_FIGURES: FeeScheduleProcessing = {
  model: "fee_first",
  percent: null,
  fixed_cents: null,
}

export type FeeSchedule = {
  default_plan_code: string
  default_fee_percent: number
  plans: FeeSchedulePlan[]
  processing?: FeeScheduleProcessing
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
    const schedule = await medusaFetch<FeeSchedule>("/store/fee-schedule", {
      method: "GET",
      next: { revalidate: 3600 },
    })
    // Twin set but the response carries no `processing`: a response cached
    // from before the API's flag was set (up to the hour above). The twin is
    // deployed first at cut-over (backend `feature-flags.ts`), so it wins and
    // no cached page can say "we absorb processing" after the switch. Twin
    // unset (today): the response passes through untouched.
    if (phase1ModuleFlags.feeFirstSplit && !schedule.processing) {
      return { ...schedule, processing: FEE_FIRST_WITHOUT_FIGURES }
    }
    return schedule
  } catch (error) {
    logger.error("[getFeeSchedule] falling back to default fee percent:", error)
    return {
      default_plan_code: "free",
      default_fee_percent: FALLBACK_DEFAULT_FEE_PERCENT,
      plans: [],
      // The backend is the source of truth for the processing model, and it
      // is unreachable. The build-time twin of its flag decides instead, so a
      // backend blip with fee-first live cannot put "we absorb processing"
      // back on the page. Twin unset (today): no field, today's wording.
      ...(phase1ModuleFlags.feeFirstSplit ? { processing: FEE_FIRST_WITHOUT_FIGURES } : {}),
    }
  }
}
