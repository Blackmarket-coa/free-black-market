import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "./auth-helpers"
import { actorId, forbidden } from "./community-read-access"
import { createLogger } from "./logger"

const log = createLogger("shared/community-write-access")

/**
 * Who may change a community record.
 *
 * `api/middlewares.ts` authenticates every write verb on the community
 * prefixes (SEC-2/3) but accepts *any* signed-in account, so a handler that
 * does not check who is calling lets one account rewrite another's garden,
 * season, zone or delivery. This file is the write-side twin of
 * `community-read-access.ts` and uses its refusal (`forbidden`, always 403).
 *
 * Writes take the strict reading throughout: an owner that cannot be
 * established is refused, not grandfathered, because there is no legacy owner
 * column to grandfather — gardens and kitchens never recorded who made them.
 */

type AuthContext = { actor_id?: string; actor_type?: string }

function authContext(req: MedusaRequest): AuthContext | undefined {
  return (req as unknown as { auth_context?: AuthContext }).auth_context
}

/**
 * True when the actor runs this garden: an **active** membership of type
 * `organizer`.
 *
 * Both qualifiers matter. `POST /store/gardens/:id/members` lets anyone join
 * any garden and choose their own `membership_type`, but always as `pending`,
 * so "has an organizer membership" alone would let a stranger appoint
 * themselves. `POST /store/gardens` creates the creator's membership as an
 * active organizer, which is how a garden gets its first manager.
 *
 * The filters go to the query layer and the rows are re-checked here, so a
 * filter the query layer drops cannot widen the result. Never throws: a
 * lookup failure denies, and is logged.
 */
export async function actorManagesGarden(
  req: MedusaRequest,
  gardenId: string | null | undefined
): Promise<boolean> {
  const id = actorId(req)
  if (!id || !gardenId) return false

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "garden_membership",
      fields: ["id", "garden_id", "customer_id", "membership_type", "status"],
      filters: {
        garden_id: gardenId,
        customer_id: id,
        membership_type: "organizer",
        status: "active",
      },
    })
    const rows = (Array.isArray(data) ? data : []) as Array<{
      garden_id?: string | null
      customer_id?: string | null
      membership_type?: string | null
      status?: string | null
    }>
    return rows.some(
      (row) =>
        row.garden_id === gardenId &&
        row.customer_id === id &&
        row.membership_type === "organizer" &&
        row.status === "active"
    )
  } catch (error) {
    log.warn(
      `[community-write-access] organizer lookup failed for garden ${gardenId}: ${
        (error as Error)?.message ?? error
      }`
    )
    return false
  }
}

/**
 * The calling seller's `sel_` id, for community resources a vendor operates
 * (kitchens, delivery zones). A customer or driver gets the shared 403; a
 * seller whose account cannot be resolved gets `requireSellerId`'s 401.
 * Returns null whenever a response has already been sent.
 */
export async function requireSellerActor(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<string | null> {
  if (authContext(req)?.actor_type !== "seller") {
    forbidden(res)
    return null
  }
  return requireSellerId(req, res)
}

/** Copy only the named keys that are present on `body`. */
export function pickAllowed<K extends string>(
  body: unknown,
  allowed: readonly K[]
): Partial<Record<K, unknown>> {
  const source =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const out: Partial<Record<K, unknown>> = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key]
    }
  }
  return out
}
