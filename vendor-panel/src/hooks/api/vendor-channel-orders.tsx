import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"

const VENDOR_CHANNEL_ORDERS_QUERY_KEY = "vendor_channel_orders" as const

export type ChannelOrderItem = {
  sku: string | null
  title: string
  quantity: number
  unit_amount: number
}

export type ChannelOrder = {
  id: string
  channel_id: string
  external_id: string
  placed_at: string
  currency_code: string
  /** Gross, what the buyer paid. */
  total_amount: number
  /** The channel's cut, when it reports one. */
  channel_fee_amount: number | null
  /** Gross minus the cut — what the vendor actually earned. */
  net_amount: number
  buyer_name: string | null
  items: ChannelOrderItem[]
  fulfilled: boolean
  fulfilled_at: string | null
  tracking_number: string | null
  fulfillment_reported: boolean
  fulfillment_error: string | null
  /** Order lines whose SKU matched no stocked variant. */
  unmatched_lines: number
}

export const useVendorChannelOrders = (
  options?: Omit<
    UseQueryOptions<{ orders: ChannelOrder[] }, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/channels/orders", { method: "GET" }),
    queryKey: [VENDOR_CHANNEL_ORDERS_QUERY_KEY, "list"],
    retry: false,
    ...options,
  })

  const response = data as { orders: ChannelOrder[] } | undefined
  return { channelOrders: response?.orders ?? [], ...rest }
}

export const useRecordChannelShipment = (
  options?: UseMutationOptions<
    unknown,
    FetchError,
    { id: string; tracking_number?: string; carrier?: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      fetchQuery(`/vendor/channels/orders/${id}/fulfillment`, {
        method: "POST",
        body,
      }),
    onSuccess: (d, v, c) => {
      queryClient.invalidateQueries({
        queryKey: [VENDOR_CHANNEL_ORDERS_QUERY_KEY],
      })
      options?.onSuccess?.(d, v, c)
    },
    ...options,
  })
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(cents / 100)

export type ChannelOrderDisplay = {
  amount: string
  /** Set only when the channel took a cut worth showing. */
  netHint: string | null
  status: string
  tone: "green" | "orange" | "red" | "grey"
  /** Set when the vendor needs to do or know something. */
  warning: string | null
}

/**
 * How one channel order should read.
 *
 * Two things get called out ahead of the ordinary status, because both are
 * cases where staying quiet costs the vendor real money:
 *
 * - **An unmatched line** means stock never moved for a sale that happened, so
 *   FBM still believes it has inventory it does not. That is an oversell in
 *   waiting, and it belongs on the order it came from rather than only in a
 *   job log nobody reads.
 * - **A shipment the channel has not accepted** is, from the marketplace's
 *   point of view, an order that was never fulfilled — which is what earns an
 *   account penalty. "Shipped" locally is not the same as reported.
 */
export function describeChannelOrder(order: ChannelOrder): ChannelOrderDisplay {
  const amount = money(order.total_amount, order.currency_code)
  const netHint =
    order.channel_fee_amount && order.channel_fee_amount > 0
      ? `${money(order.net_amount, order.currency_code)} after ${money(
          order.channel_fee_amount,
          order.currency_code
        )} channel fee`
      : null

  if (order.unmatched_lines > 0) {
    return {
      amount,
      netHint,
      status: "Check stock",
      tone: "red",
      warning:
        order.unmatched_lines === 1
          ? "1 line did not match a stocked product, so its stock was not reduced."
          : `${order.unmatched_lines} lines did not match a stocked product, so their stock was not reduced.`,
    }
  }

  if (!order.fulfilled) {
    return { amount, netHint, status: "Awaiting shipment", tone: "orange", warning: null }
  }

  if (!order.fulfillment_reported) {
    return {
      amount,
      netHint,
      status: "Reporting shipment",
      tone: "orange",
      warning:
        order.fulfillment_error ??
        "Recorded here; the channel has not confirmed it yet.",
    }
  }

  return { amount, netHint, status: "Shipped", tone: "green", warning: null }
}
