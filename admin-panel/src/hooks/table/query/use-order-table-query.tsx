import type { HttpTypes } from "@medusajs/types"
import { useQueryParams } from "../../use-query-params"

type UseOrderTableQueryProps = {
  prefix?: string
  pageSize?: number
}

export const useOrderTableQuery = ({
  prefix,
  pageSize = 20,
}: UseOrderTableQueryProps) => {
  const queryObject = useQueryParams(
    [
      "offset",
      "q",
      "created_at",
      "updated_at",
      "region_id",
      "sales_channel_id",
      "payment_status",
      "fulfillment_status",
      "order",
    ],
    prefix
  )

  const {
    offset,
    sales_channel_id,
    created_at,
    updated_at,
    fulfillment_status,
    payment_status,
    region_id,
    q,
    order,
  } = queryObject

  // AdminOrderFilters in @medusajs/types omits fulfillment_status /
  // payment_status declarations but the backend accepts them; cast to
  // satisfy TS without losing the SDK shape for the other fields.
  const searchParams: HttpTypes.AdminOrderFilters = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    sales_channel_id: sales_channel_id?.split(","),
    fulfillment_status: fulfillment_status?.split(","),
    payment_status: payment_status?.split(","),
    created_at: created_at ? JSON.parse(created_at) : undefined,
    updated_at: updated_at ? JSON.parse(updated_at) : undefined,
    region_id: region_id?.split(","),
    order: order ? order : "-display_id",
    q,
  } as HttpTypes.AdminOrderFilters

  return {
    searchParams,
    raw: queryObject,
  }
}
