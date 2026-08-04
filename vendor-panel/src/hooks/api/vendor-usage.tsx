import { useQuery } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"

const VENDOR_USAGE_QUERY_KEY = "vendor_usage" as const

export type UsageLevel = "ok" | "approaching" | "at_limit"

export type ResourceUsage = {
  key: string
  label: string
  /** Render the numbers as sizes rather than as a count. */
  is_bytes?: boolean
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

/**
 * Bytes as something a person can read. Mirrors the backend's `formatBytes`,
 * because a quota conversation happens in gigabytes and nobody reconciles
 * a ten-digit number against their own files.
 */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = Math.max(0, bytes)
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return unit === 0
    ? `${Math.round(value)} B`
    : `${value.toFixed(1)} ${units[unit]}`
}

export function describeUsage(resource: ResourceUsage): UsageDisplay {
  // A byte quota is consumed exactly like a document quota — only the unit
  // differs, so this formats and otherwise takes the identical path.
  const fmt = (n: number) => (resource.is_bytes ? formatBytes(n) : `${n}`)

  if (resource.unlimited) {
    return { amount: fmt(resource.current), tone: "grey", hint: null }
  }

  const amount = `${fmt(resource.current)} of ${fmt(resource.limit ?? 0)}`

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
      hint: resource.is_bytes
        ? `${fmt(resource.remaining ?? 0)} left on your plan.`
        : resource.remaining === 1
          ? "1 left on your plan."
          : `${resource.remaining} left on your plan.`,
    }
  }
  return { amount, tone: "grey", hint: null }
}
