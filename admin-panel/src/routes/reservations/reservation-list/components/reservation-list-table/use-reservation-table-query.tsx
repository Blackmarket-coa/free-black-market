import type { HttpTypes } from "@medusajs/types"
import { useQueryParams } from "@hooks/use-query-params"

export const useReservationTableQuery = ({
  pageSize = 20,
  prefix,
}: {
  pageSize?: number
  prefix?: string
}) => {
  const raw = useQueryParams(
    ["location_id", "offset", "created_at", "quantity", "updated_at", "order"],
    prefix
  )

  const { location_id, created_at, updated_at, order, offset, ...rest } = raw

  // `quantity` and other free-form query params are passed through via
  // ...rest; AdminGetReservationsParams in @medusajs/types doesn't
  // declare those, so cast the assembled record to satisfy TS.
  const searchParams: HttpTypes.AdminGetReservationsParams = {
    limit: pageSize,
    offset: offset ? parseInt(offset) : undefined,
    location_id: location_id,
    created_at: created_at ? JSON.parse(created_at) : undefined,
    updated_at: updated_at ? JSON.parse(updated_at) : undefined,
    order: order ?? "-created_at",
    ...rest,
  } as HttpTypes.AdminGetReservationsParams

  return {
    searchParams,
    raw,
  }
}
