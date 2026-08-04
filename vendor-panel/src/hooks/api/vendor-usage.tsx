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

export type VendorUsageResponse = {
  plan_code: string
  resources: ResourceUsage[]
  allowances: PlanAllowance[]
  any_at_limit: boolean
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
    anyAtLimit: response?.any_at_limit ?? false,
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
