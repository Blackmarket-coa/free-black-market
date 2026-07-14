import { UseQueryOptions, useQuery } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PRODUCT_ANALYTICS_QUERY_KEY = "product_analytics" as const
export const productAnalyticsQueryKeys = queryKeysFactory(
  PRODUCT_ANALYTICS_QUERY_KEY
)

const CREATOR_ANALYTICS_QUERY_KEY = "creator_analytics" as const
export const creatorAnalyticsQueryKeys = queryKeysFactory(
  CREATOR_ANALYTICS_QUERY_KEY
)

export type ProductAnalytics = {
  range_days: number
  funnel: {
    views: number
    add_to_carts: number
    orders: number
    units: number
    conversion: number | null
  }
  by_product: {
    product_id: string
    title: string | null
    views: number
    add_to_carts: number
    orders: number
    units: number
    conversion: number | null
  }[]
  by_day: { date: string; views: number; add_to_carts: number }[]
}

export type CreatorAnalytics = {
  range_days: number
  totals: {
    profile_views: number
    link_clicks: number
    affiliate_clicks: number
    attributed_orders: number
    commission_cents: number
  }
  by_day: { date: string; profile_views: number; link_clicks: number }[]
  by_campaign: { campaign: string; events: number; link_clicks: number }[]
}

/** GET /vendor/analytics/products?range= */
export const useProductAnalytics = (
  range = 30,
  options?: Omit<
    UseQueryOptions<ProductAnalytics, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(`/vendor/analytics/products?range=${range}`, {
        method: "GET",
      }),
    queryKey: productAnalyticsQueryKeys.list({ range }),
    ...options,
  })
  return { analytics: data as ProductAnalytics | undefined, ...rest }
}

/** GET /vendor/analytics/creator?range= */
export const useCreatorAnalytics = (
  range = 30,
  options?: Omit<
    UseQueryOptions<CreatorAnalytics, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(`/vendor/analytics/creator?range=${range}`, {
        method: "GET",
      }),
    queryKey: creatorAnalyticsQueryKeys.list({ range }),
    ...options,
  })
  return { analytics: data as CreatorAnalytics | undefined, ...rest }
}
