import type { ReturnRequest } from "@/types/order-return"

/**
 * When a return was requested: its first line's timestamp, else the
 * return's own. `/store/return-request` serves only requests with at least
 * one line, but the page must not crash on one without (it did, on an
 * operator's draft return), so neither is assumed.
 */
export const returnRequestedAt = (
  request: Pick<ReturnRequest, "line_items" | "created_at">
): string | undefined =>
  request.line_items?.[0]?.created_at ?? request.created_at ?? undefined

const timeOf = (request: Pick<ReturnRequest, "line_items" | "created_at">) => {
  const at = returnRequestedAt(request)
  const time = at ? new Date(at).getTime() : NaN
  return Number.isNaN(time) ? 0 : time
}

/** Newest request first; undated requests last. Does not mutate its input. */
export const sortReturnRequestsNewestFirst = <
  T extends Pick<ReturnRequest, "line_items" | "created_at">,
>(
  requests: T[]
): T[] => [...requests].sort((a, b) => timeOf(b) - timeOf(a))
