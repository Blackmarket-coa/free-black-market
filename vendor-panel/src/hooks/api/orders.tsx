import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  QueryClient,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
  useQueryClient,
} from "@tanstack/react-query"
import { fetchQuery, getAuthToken, sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory, TQueryKey } from "../../lib/query-key-factory"
import { inventoryItemsQueryKeys } from "./inventory"
import { reservationItemsQueryKeys } from "./reservations"
import { filterOrders } from "../../routes/orders/common/orderFiltering"
import {
  ExtendedAdminOrderResponse,
  OrderCommission,
} from "../../types/order"
import { fetchRegistrationStatus, RegistrationStatusResponse, usersQueryKeys } from "./users"

const ORDERS_QUERY_KEY = "orders" as const
const _orderKeys = queryKeysFactory(ORDERS_QUERY_KEY) as TQueryKey<"orders"> & {
  preview: (orderId: string) => QueryKey
  changes: (orderId: string) => QueryKey
  lineItems: (orderId: string) => QueryKey
}

_orderKeys.preview = function (id: string) {
  return [this.detail(id), "preview"]
}

_orderKeys.changes = function (id: string) {
  return [this.detail(id), "changes"]
}

_orderKeys.lineItems = function (id: string) {
  return [this.detail(id), "lineItems"]
}

export const ordersQueryKeys = _orderKeys

const ensureApprovedSeller = async (queryClient: QueryClient): Promise<boolean> => {
  const token = getAuthToken()
  if (!token) {
    return false
  }

  const cachedStatus = queryClient.getQueryData<RegistrationStatusResponse>(
    usersQueryKeys.registrationStatus()
  )
  const status = cachedStatus ?? (await fetchRegistrationStatus(token))
  return status.status === "approved" && Boolean(status.seller_id)
}

export const useOrder = (
  id: string,
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<
      ExtendedAdminOrderResponse,
      FetchError,
      ExtendedAdminOrderResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery(`/vendor/orders/${id}`, {
        method: "GET",
        query: query as Record<string, string | number>,
      })
    },
    queryKey: ordersQueryKeys.detail(id, query),
    ...options,
  })

  return { order: data?.order, ...rest }
}

export const useOrderCommission = (
  id: string,
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<OrderCommission, FetchError, OrderCommission, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery(`/vendor/orders/${id}/commission`, {
        method: "GET",
        query: query as Record<string, string | number>,
      })
    },
    queryKey: ordersQueryKeys.detail(`${id}/commission`, query),
    ...options,
  })

  return { commission: data?.commission, ...rest }
}

export const useOrderPreview = (
  id: string,
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderPreviewResponse,
      FetchError,
      HttpTypes.AdminOrderPreviewResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery(`/vendor/orders/${id}`, {
        method: "GET",
        query: query as Record<string, string | number>,
      })
    },
    queryKey: ordersQueryKeys.preview(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrders = (
  query?: HttpTypes.AdminOrderFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderListResponse,
      FetchError,
      HttpTypes.AdminOrderListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
  filters?: {
    order_status?: HttpTypes.AdminOrder["fulfillment_status"]
    created_at?: Record<string, string | Date>
    updated_at?: Record<string, string | Date>
    sort?: string
  }
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery("/vendor/orders", {
        method: "GET",
        query: query as { [key: string]: string },
      })
    },
    queryKey: ordersQueryKeys.list(query),
    ...options,
  })

  const { order_status, sort, ...dateFilters } = filters ?? {}
  const filteredOrders =
    filterOrders(data?.orders, dateFilters, sort) || []

  const filtered = order_status
    ? filteredOrders.filter(
        (order) => order.fulfillment_status === order_status
      )
    : filteredOrders

  const count = data?.count || 0

  return { count, orders: filtered, ...rest }
}

export const useOrderChanges = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderChangesResponse,
      FetchError,
      HttpTypes.AdminOrderChangesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery(`/vendor/orders/${id}/changes`, {
        method: "GET",
      })
    },
    queryKey: ordersQueryKeys.changes(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderLineItems = (
  id: string,
  query?: Record<string, string | number>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderLineItemsListResponse,
      FetchError,
      HttpTypes.AdminOrderLineItemsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      if (!(await ensureApprovedSeller(queryClient))) {
        return undefined
      }

      return fetchQuery(`/vendor/orders/${id}`, {
        method: "GET",
        query,
      })
    },
    queryKey: ordersQueryKeys.lineItems(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateOrderFulfillment = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminCreateOrderFulfillment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderFulfillment) =>
      fetchQuery(`/vendor/orders/${orderId}/fulfillments`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrderFulfillment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminCancelOrderFulfillment
  >
) => {
  return useMutation({
    mutationFn: (payload: { no_notification?: boolean }) =>
      sdk.admin.order.cancelFulfillment(orderId, fulfillmentId, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateOrderShipment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminCreateOrderShipment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderShipment) =>
      fetchQuery(
        `/vendor/orders/${orderId}/fulfillments/${fulfillmentId}/shipments`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useMarkOrderFulfillmentAsDelivered = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery(
        `/vendor/orders/${orderId}/fulfillments/${fulfillmentId}/mark-as-delivered`,
        {
          method: "POST",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrder = (
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminOrderResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery(`/vendor/orders/${orderId}/cancel`, {
        method: "POST",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.list(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCompleteOrder = (
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminOrderResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery(`/vendor/orders/${orderId}/complete`, {
        method: "POST",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.list(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRequestTransferOrder = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminRequestOrderTransfer
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminRequestOrderTransfer) =>
      sdk.admin.order.requestTransfer(orderId, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrderTransfer = (
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminOrderResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => sdk.admin.order.cancelTransfer(orderId),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}


export const useManualFulfillmentTransition = (
  orderId: string,
  options?: UseMutationOptions<any, FetchError, {
    supplier_id: string
    next_status: "acknowledged" | "in_progress" | "shipped" | "delivered" | "canceled"
    notes?: string
  }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery(`/vendor/orders/${orderId}/manual-fulfillment`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKeys.detail(orderId) })
      queryClient.invalidateQueries({ queryKey: ordersQueryKeys.preview(orderId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
