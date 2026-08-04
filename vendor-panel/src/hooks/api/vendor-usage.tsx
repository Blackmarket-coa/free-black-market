import { useQuery } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"

const VENDOR_USAGE_QUERY_KEY = "vendor_usage" as const

export type UsageLevel = "ok" | "approaching" | "at_limit"

export type ResourceUsage = {
  key: string
  label: string
  current: number
  /** null means unlimited. */
  limit: number | null
  remaining: number | null
  percent_used: number | null
  level: UsageLevel
  unlimited: boolean
}

export type PlanAllowance = {
  key: string
  label: string
  limit: number
}

export type MeteredLevel = "ok" | "approaching" | "over"

export type MeteredUsage = {
  metric: string
  label: string
  recorded: number
  /** null means unlimited. */
  included: number | null
  unlimited: boolean
  /** Not clamped to 100 — past the allowance is a price, not a wall. */
  percent_used: number | null
  level: MeteredLevel
  excess: number
  blocks: number
  projected_amount_cents: number
  block_size: number
  cents_per_block: number
  period_start: string
  period_end: string
}

export type VendorUsageResponse = {
  plan_code: string
  resources: ResourceUsage[]
  allowances: PlanAllowance[]
  metered: MeteredUsage[]
  any_at_limit: boolean
  projected_overage_cents: number
}

export const useVendorUsage = (
  options?: Omit<
    UseQueryOptions<VendorUsageResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/usage", { method: "GET" }),
    queryKey: [VENDOR_USAGE_QUERY_KEY, "detail"],
    retry: false,
    ...options,
  })

  const response = data as VendorUsageResponse | undefined

  return {
    planCode: response?.plan_code ?? null,
    resources: response?.resources ?? [],
    allowances: response?.allowances ?? [],
    metered: response?.metered ?? [],
    anyAtLimit: response?.any_at_limit ?? false,
    projectedOverageCents: response?.projected_overage_cents ?? 0,
    ...rest,
  }
}

/**
 * How a usage row should read.
 *
 * `unlimited` shows the count alone — "3" rather than "3 of ∞", which invites
 * the reader to work out a fraction that does not exist. Everything else shows
 * "current of limit", and only a warning state gets a call to action, so an
 * ordinary row stays quiet.
 */
export type UsageDisplay = {
  amount: string
  tone: "grey" | "orange" | "red"
  /** Set only when the vendor should act. */
  hint: string | null
}

export function describeUsage(resource: ResourceUsage): UsageDisplay {
  if (resource.unlimited) {
    return { amount: `${resource.current}`, tone: "grey", hint: null }
  }

  const amount = `${resource.current} of ${resource.limit}`

  if (resource.level === "at_limit") {
    return {
      amount,
      tone: "red",
      hint: "Upgrade your plan to add more.",
    }
  }
  if (resource.level === "approaching") {
    return {
      amount,
      tone: "orange",
      hint:
        resource.remaining === 1
          ? "1 left on your plan."
          : `${resource.remaining} left on your plan.`,
    }
  }
  return { amount, tone: "grey", hint: null }
}

const count = (value: number) => new Intl.NumberFormat("en-US").format(value)

/**
 * Cents as money.
 *
 * Charges are created without an explicit currency and fall back to USD
 * server-side, so there is no per-seller currency to thread through here yet.
 * Hardcoding the same fallback keeps the projection and the resulting charge
 * reading identically rather than inventing a currency field the biller never
 * sets.
 */
const cost = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)

/**
 * How a metered row should read.
 *
 * The difference from `describeUsage` is what "past the line" means. A capped
 * resource that is full tells the vendor to upgrade, because the next create
 * fails. A meter that is past its included volume tells them what it costs,
 * because nothing fails — their embeds keep serving and the difference shows up
 * on an invoice. Showing an upgrade prompt there would misdescribe a working
 * system as a broken one; showing the amount lets them decide whether a bigger
 * plan is cheaper than the overage, which is the actual choice in front of them.
 */
export type MeteredDisplay = {
  amount: string
  tone: "grey" | "orange" | "red"
  hint: string | null
}

export function describeMeteredUsage(usage: MeteredUsage): MeteredDisplay {
  if (usage.unlimited) {
    return { amount: count(usage.recorded), tone: "grey", hint: null }
  }

  const amount = `${count(usage.recorded)} of ${count(usage.included ?? 0)}`

  if (usage.level === "over") {
    return {
      amount,
      tone: "red",
      hint: usage.projected_amount_cents
        ? `${count(usage.excess)} over — about ${cost(
            usage.projected_amount_cents
          )} on next month's invoice.`
        : `${count(usage.excess)} over your included volume.`,
    }
  }

  if (usage.level === "approaching") {
    const remaining = Math.max(0, (usage.included ?? 0) - usage.recorded)
    return {
      amount,
      tone: "orange",
      hint: `${count(remaining)} left before overage is charged.`,
    }
  }

  return { amount, tone: "grey", hint: null }
}

/**
 * The one line summarising what this period will cost beyond the plan.
 *
 * `null` when nothing is projected — a "$0.00 projected" line is noise that
 * trains vendors to ignore the row that eventually matters.
 */
export function describeProjectedOverage(cents: number): string | null {
  if (!cents || cents <= 0) return null
  return `Projected overage this period: ${cost(cents)}. Charged after the period closes.`
}
