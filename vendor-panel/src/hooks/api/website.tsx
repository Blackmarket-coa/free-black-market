import {
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const WEBSITE_QUERY_KEY = "website" as const
export const websiteQueryKeys = queryKeysFactory(WEBSITE_QUERY_KEY)

export type SiteStatus = "none" | "provisioning" | "live" | "failed"

export type FbmWebsite = {
  handle: string
  connect_domains: string[]
  site_status: SiteStatus
  site_url: string | null
  site_repo: string | null
  launch_available: boolean
  api_base: string
  storefront_url: string
  sdk_url: string
  snippet: string
}

export type FbmWebsiteResponse = { website: FbmWebsite }

/**
 * GET /vendor/website — the vendor's Connect snippet, whitelisted domains, and
 * Launch status for the "My Website" tab.
 */
export const useWebsite = (
  options?: Omit<
    UseQueryOptions<FbmWebsiteResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/website", { method: "GET" }),
    queryKey: websiteQueryKeys.details(),
    ...options,
  })

  return { website: data?.website as FbmWebsite | undefined, ...rest }
}

/**
 * POST /vendor/website — save the Connect domain whitelist.
 */
export const useUpdateWebsiteDomains = (
  options?: UseMutationOptions<FbmWebsiteResponse, FetchError, string[]>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connect_domains: string[]) =>
      fetchQuery("/vendor/website", {
        method: "POST",
        body: { connect_domains },
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.details() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * POST /vendor/website/launch — provision a standardized FBM-hosted site.
 */
export const useLaunchWebsite = (
  options?: UseMutationOptions<
    FbmWebsiteResponse & { launched?: boolean },
    FetchError,
    { subdomain?: string } | void
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body?: { subdomain?: string } | void) =>
      fetchQuery("/vendor/website/launch", {
        method: "POST",
        body: (body || {}) as object,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: websiteQueryKeys.details() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
