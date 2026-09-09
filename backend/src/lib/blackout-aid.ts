import { toPublicAid } from "./aid-location"

/**
 * The §3.8 aid-mirror wire shape.
 *
 * Blackout's Coalition board publishes its rows verbatim, with no projection of
 * its own — so what crosses this seam is what the world sees. The only
 * defensible input is therefore `toPublicAid`'s output, and this function takes
 * exactly that. Two whitelists end up in series: the projection, and the
 * explicit literal below. Neither has a spread in it, so a column added to
 * `MutualAidRequest` cannot reach the wire by being forgotten about here.
 *
 * The rename to camelCase is the whole of the rest of it. FBM's own surface is
 * snake_case; the Blackout bridge parses camelCase, and `id` becomes
 * `requestId` because on the far side it is a foreign key, not the row's id.
 */
export type BlackoutAidFields = {
  requestId: string
  title: string
  description: string
  category: string | null
  status: string
  quantity: number | null
  unitOfMeasure: string | null
  locality: string | null
  createdAt: string | null
}

export function toBlackoutAidFields(row: Record<string, unknown>): BlackoutAidFields {
  const projected = toPublicAid(row)

  return {
    requestId: projected.id,
    title: projected.title,
    description: projected.description,
    category: projected.category,
    status: projected.status,
    quantity: projected.quantity,
    unitOfMeasure: projected.unit_of_measure,
    locality: projected.locality,
    createdAt: projected.created_at ?? null,
  }
}

/**
 * Which of the three aid event types a request's status calls for.
 *
 * `MATCHED` is deliberately `opened`: a helper having committed is not the ask
 * leaving the board, and the mirror maps it to `in_progress` from the status
 * field. `null` means nothing should be emitted — `OPEN` on a status change is
 * the request coming back, which no current path produces.
 */
export function aidEventTypeFor(status: string | null | undefined): string | null {
  switch (status) {
    case "OPEN":
    case "MATCHED":
      return "aid.request.opened"
    case "FULFILLED":
      return "aid.request.fulfilled"
    case "WITHDRAWN":
    case "EXPIRED":
      return "aid.request.closed"
    default:
      return null
  }
}
