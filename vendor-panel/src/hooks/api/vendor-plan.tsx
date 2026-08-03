import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const VENDOR_PLAN_QUERY_KEY = "vendor_plan" as const

/**
 * The seller's billing plan and the feature keys they actually hold.
 *
 * `feature_keys` is the same union the backend gate enforces (plan features
 * plus any directly held entitlements), so the panel and the gate cannot
 * disagree about what a vendor has. Anything rendered off this should read
 * `feature_keys`, never the plan code — a comped feature is real but is not
 * implied by the plan.
 */
export type VendorPlanFeatureKey = string

export type VendorPlanSummary = {
  code: string
  status: "trialing" | "active" | "past_due" | "canceled"
  current_period_end: string | null
  trial_ends_at: string | null
  cancel_at_period_end: boolean
  pending_plan_code: string | null
  pending_effective_at: string | null
  /**
   * The plan's marketplace take rate, as a percentage. `null` means the plan
   * expresses no opinion and the platform default applies.
   *
   * Not necessarily what this seller is actually charged: a negotiated
   * per-seller override wins over the plan rate, and only the backend payout
   * module can resolve that. Display it as the plan's rate, not as "your rate".
   */
  platform_fee_percent: number | null
}

/**
 * Quantitative plan allowances. `null` means unlimited — never 0, which is a
 * real (and very restrictive) cap, so `?? Infinity` is the wrong reflex and
 * falsiness must not be used to test for "no limit".
 */
export type VendorPlanLimits = {
  embed_requests_per_minute: number
  analytics_range_days: number
  embed_keys: number | null
  connect_domains: number | null
  webhook_subscriptions: number | null
  vault_documents: number | null
}

export type AvailablePlan = {
  code: string
  display_name: string
  description: string
  price_amount: number
  currency_code: string
  interval: "month" | "year" | "none"
  trial_days: number
  display_order: number
  feature_keys: VendorPlanFeatureKey[]
  limits: VendorPlanLimits
  /** The reason to upgrade that is not a feature: a lower take rate. */
  platform_fee_percent: number | null
}

export type VendorPlanResponse = {
  plan: VendorPlanSummary
  feature_keys: VendorPlanFeatureKey[]
  limits: VendorPlanLimits
  available_plans: AvailablePlan[]
}

export const vendorPlanQueryKeys = queryKeysFactory(VENDOR_PLAN_QUERY_KEY)

export const useVendorPlan = (
  options?: Omit<
    UseQueryOptions<VendorPlanResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/plan/me", { method: "GET" }),
    queryKey: vendorPlanQueryKeys.lists(),
    // Mirrors the backend gate's cache window, so the panel does not show a
    // stale entitlement long after the gate stopped honouring it.
    staleTime: 30_000,
    retry: false,
    ...options,
  })

  const response = data as VendorPlanResponse | undefined

  return {
    plan: response?.plan,
    featureKeys: response?.feature_keys ?? [],
    limits: response?.limits,
    availablePlans: response?.available_plans ?? [],
    ...rest,
  }
}

/**
 * Does the seller hold this feature?
 *
 * While the plan is still loading this returns `true` — optimistic on purpose.
 * The backend gate is the actual enforcement; rendering a surface briefly and
 * having the request fail is recoverable, whereas hiding a paid feature a
 * vendor is entitled to on every page load is not.
 */
export const useHasPlanFeature = (featureKey: VendorPlanFeatureKey) => {
  const { featureKeys, isPending, isError } = useVendorPlan()
  if (isPending || isError) return true
  return featureKeys.includes(featureKey)
}

export const useChangeVendorPlan = (
  options?: UseMutationOptions<
    unknown,
    FetchError,
    { plan_code: string; idempotency_key?: string }
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body) =>
      fetchQuery("/vendor/plan/change", { method: "POST", body }),
    onSuccess: (data, variables, context) => {
      // The gate's server-side cache is invalidated by the transition itself;
      // this clears the panel's copy so the UI updates in the same beat.
      queryClient.invalidateQueries({ queryKey: vendorPlanQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Read a plan denial off a thrown fetchQuery error.
 *
 * `fetchQuery` throws an Error carrying `details.backendBody`, so a 402 from the
 * backend can be turned into an upsell rather than a generic failure toast.
 * Two kinds arrive on the same status and need different copy:
 *
 * - `plan_upgrade_required` — the surface is not in the plan at all
 *   (`requirePlanFeature`). Carries `required_feature`.
 * - `plan_limit_reached` — the surface is included but the allowance is spent
 *   (`respondPlanLimitReached`). Carries `limit_key`, `limit` and `current`.
 *
 * Returns null for anything else — notably a 503 `plan_check_unavailable`,
 * which is a transient backend problem and must not be shown to the vendor as
 * "upgrade to continue".
 */
export type PlanDenial = {
  kind: "feature" | "limit"
  requiredFeature: string | null
  currentPlan: string | null
  upgradeUrl: string
  message: string
  /** Present only when `kind` is "limit". */
  limitKey: string | null
  limit: number | null
  current: number | null
}

export function parsePlanDenial(error: unknown): PlanDenial | null {
  const details = (
    error as { details?: { status?: number; backendBody?: Record<string, unknown> } }
  )?.details
  if (!details || details.status !== 402) return null

  const body = details.backendBody ?? {}
  const isFeature = body.code === "plan_upgrade_required"
  const isLimit = body.code === "plan_limit_reached"
  if (!isFeature && !isLimit) return null

  return {
    kind: isLimit ? "limit" : "feature",
    requiredFeature: (body.required_feature as string) ?? null,
    currentPlan: (body.current_plan as string) ?? null,
    upgradeUrl: (body.upgrade_url as string) ?? "/settings/billing",
    message:
      (body.message as string) ??
      (isLimit
        ? "You have used everything your plan allows here. Upgrade to add more."
        : "Your plan does not include this feature. Upgrade to enable it."),
    limitKey: isLimit ? ((body.limit_key as string) ?? null) : null,
    // `limit` is null for an unlimited allowance, so `?? null` is the right
    // normalization — absent and unlimited both read as "no number to show".
    limit: isLimit ? ((body.limit as number) ?? null) : null,
    current: isLimit ? ((body.current as number) ?? null) : null,
  }
}
