import { useQuery } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"

const VENDOR_TENANCY_QUERY_KEY = "vendor_tenancy" as const

export type TenancyTier = "tier0_public" | "tier1_verified" | "tier2_aligned_org"

export type VendorTenancyResponse = {
  tier: TenancyTier
  in_organization: boolean
  gates: Record<string, boolean>
  granted_gates: string[]
  granted_feature_keys: string[]
}

export const useVendorTenancy = (
  options?: Omit<
    UseQueryOptions<VendorTenancyResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/tenancy/context", { method: "GET" }),
    queryKey: [VENDOR_TENANCY_QUERY_KEY, "detail"],
    retry: false,
    ...options,
  })

  const response = data as VendorTenancyResponse | undefined

  return {
    tier: response?.tier ?? "tier0_public",
    inOrganization: response?.in_organization ?? false,
    gates: response?.gates ?? {},
    grantedGates: response?.granted_gates ?? [],
    grantedFeatureKeys: response?.granted_feature_keys ?? [],
    ...rest,
  }
}

const TIER_LABELS: Record<TenancyTier, string> = {
  tier0_public: "Public",
  tier1_verified: "Verified organization",
  tier2_aligned_org: "Aligned organization",
}

/**
 * The line explaining features a seller has but did not buy.
 *
 * A seller inside a white-label organization sees capabilities their plan does
 * not list, because their organization's tier floors their entitlements. Left
 * unexplained that reads as a bug — or worse, as something that might vanish
 * without notice. `null` for a seller with no organization, which is the
 * ordinary case: there is nothing to explain and an empty row would only
 * prompt the question it cannot answer.
 */
export function describeTenancyGrant(
  tier: TenancyTier,
  grantedFeatureKeys: string[]
): string | null {
  if (tier === "tier0_public" || grantedFeatureKeys.length === 0) return null

  const noun = grantedFeatureKeys.length === 1 ? "feature" : "features"
  return `${TIER_LABELS[tier]}: ${grantedFeatureKeys.length} additional ${noun} included by your organization, on top of your plan.`
}
