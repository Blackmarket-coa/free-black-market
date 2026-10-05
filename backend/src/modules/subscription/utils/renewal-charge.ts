import { BigNumber, MathBN } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"
import { SubscriptionInterval } from "../types"
import { addInterval } from "./interval"

/**
 * Pure pieces of the off-session renewal charge
 * (`workflows/subscription/renewal-charge.ts` is the Stripe seam).
 */

/**
 * The period a renewal pays for starts one interval after the last order.
 *
 * Derived from `last_order_date`, which only moves when a cycle actually
 * rolls (`recordNewSubscriptionOrder`). It deliberately does NOT read
 * `next_order_date`: the dunning loop rewrites that to each retry date, so a
 * key built from it would change on every retry of the same cycle.
 */
export function renewalPeriodStart(
  lastOrderDate: Date | string,
  interval: SubscriptionInterval
): Date {
  return addInterval(lastOrderDate, interval)
}

/**
 * The Stripe idempotency key for one cycle's renewal charge, derived entirely
 * from the subscription record (never from the attempt):
 *
 *   subscription-renewal:<subscription id>:<period start ISO>
 *
 * Any re-presentation of the same cycle inside Stripe's 24-hour key retention
 * carries the same key, so Stripe returns the first intent. The key alone is
 * NOT the double-charge guard past 24 hours (dunning retries are 1/3/7 days
 * apart): that guard is the cycle's intent id, persisted on the record before
 * the intent is confirmed and retrieved before any retry
 * (`workflows/subscription/renewal-charge.ts`).
 */
export function renewalIdempotencyKey(args: {
  subscription_id: string
  period_start: Date
}): string {
  return `subscription-renewal:${args.subscription_id}:${args.period_start.toISOString()}`
}

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
])
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"])

/**
 * Medusa amounts are major units; Stripe wants the smallest unit as an
 * integer. Same table and rounding as the installed provider's
 * `getSmallestUnit` (@medusajs/payment-stripe 2.14.2
 * dist/utils/get-smallest-unit.js) and `stripe-connect-direct`'s copy.
 */
export function toSmallestUnit(amount: BigNumberInput, currencyCode: string): number {
  const code = currencyCode.toUpperCase()
  const power = ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2
  const multiplier = Math.pow(10, power)
  const scaled = Math.round(new BigNumber(MathBN.mult(amount, multiplier)).numeric)
  return power === 3 ? Math.ceil(scaled / 10) * 10 : scaled
}
