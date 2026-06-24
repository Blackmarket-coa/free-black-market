import { UseQueryOptions, useQuery } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const EMBED_ANALYTICS_QUERY_KEY = "embed_analytics" as const
export const embedAnalyticsQueryKeys = queryKeysFactory(EMBED_ANALYTICS_QUERY_KEY)

export type EmbedAnalytics = {
  range_days: number
  totals: Record<string, number>
  funnel: {
    views: number
    add_to_cart: number
    checkout_start: number
    orders: number
  }
  by_origin: { origin: string; count: number }[]
  by_day: { date: string; views: number; orders: number }[]
  top_products: { product_id: string; views: number }[]
}

/** GET /vendor/analytics/embed?range= */
export const useEmbedAnalytics = (
  range = 30,
  options?: Omit<
    UseQueryOptions<{ analytics: EmbedAnalytics }, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(`/vendor/analytics/embed?range=${range}`, { method: "GET" }),
    queryKey: embedAnalyticsQueryKeys.list({ range }),
    ...options,
  })
  return { analytics: data?.analytics as EmbedAnalytics | undefined, ...rest }
}
