import { FetchError } from "@medusajs/js-sdk"
import { PaginatedResponse } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { fetchQuery } from "../../lib/client"
import { queryClient } from "../../lib/query-client"

const REQUESTS_QUERY_KEY = "requests" as const
export const requestsQueryKeys = queryKeysFactory(REQUESTS_QUERY_KEY)

export const useRequest = (
  id: string,
  query?: { [key: string]: string | number },
  options?: Omit<
    UseQueryOptions<
      {
        request: any
      },
      FetchError,
      {
        request: any
      },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: requestsQueryKeys.detail(id),
    queryFn: async () =>
      fetchQuery(`/vendor/requests/${id}`, {
        method: "GET",
        query: query as { [key: string]: string | number },
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRequests = (
  query?: Record<string, string | number>,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{
        requests: any
      }>,
      FetchError,
      PaginatedResponse<{
        requests: any
      }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/requests", {
        method: "GET",
        query: query as { [key: string]: string | number },
      }),

    queryKey: [REQUESTS_QUERY_KEY, "list"],
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateVendorRequest = (
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery("/vendor/requests", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: [REQUESTS_QUERY_KEY, "list"],
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateRequest = (
  id: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery(`/vendor/requests/${id}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: [REQUESTS_QUERY_KEY, "list"],
      })

      queryClient.invalidateQueries({
        queryKey: requestsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// Order return requests are served by the vendor Returns endpoint
// (`/vendor/returns`). The `/vendor/return-request` path the panel was
// originally built against has no handler in the current MercurJS core, so
// these hooks read from `/vendor/returns` and normalize the `return`/`returns`
// payload back onto the `order_return_request` shape the UI consumes.
export const normalizeReturnDetailResponse = (data?: { return?: any }) => ({
  order_return_request: data?.return,
})

export const normalizeReturnListResponse = (data?: {
  returns?: any
  count?: number
}) => ({
  order_return_request: data?.returns,
  count: data?.count || 0,
})

export const useOrderReturnRequest = (
  id: string,
  options?: UseQueryOptions<any, FetchError, any>
) => {
  const { data, ...rest } = useQuery({
    queryKey: [REQUESTS_QUERY_KEY, "return-request", id],
    queryFn: () =>
      fetchQuery(`/vendor/returns/${id}`, {
        method: "GET",
        query: { fields: "*order,*order.customer,*items" },
      }),
    ...options,
  })

  return { ...normalizeReturnDetailResponse(data), ...rest }
}

export const useOrderReturnRequests = (
  query?: Record<string, string | number>,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{
        returns: any
      }>,
      FetchError,
      PaginatedResponse<{
        returns: any
      }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/returns", {
        method: "GET",
        query: {
          fields: "id,status,created_at,*order,*order.customer,*items",
          ...query,
        },
      }),

    queryKey: [REQUESTS_QUERY_KEY, "return-requests", query],
    ...options,
  })

  return { ...normalizeReturnListResponse(data), ...rest }
}
