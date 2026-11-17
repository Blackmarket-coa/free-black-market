import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Which store, and as which member, a seller actor may act.
 *
 * A seller token's actor, like a login's `app_metadata.seller_id`, is a member
 * id (`mem_`, what Mercur links) or a seller id (`sel_`, what approval links,
 * and what the seller-auth backfill used to write for any member).
 *
 * - A member id acts as that member, while neither it nor its store is
 *   deleted. Mercur's deleteMemberStep soft-deletes a removed member and
 *   leaves the login's link naming it; signing in mints that member as the
 *   actor again.
 * - A seller id acts as the live member of that store whose email is the
 *   login's own address: the entity_id of its emailpass provider identity, as
 *   approval and the backfill match on, compared trimmed and ignoring case.
 *   If several live members share it, the earliest made (created_at, then
 *   id). With none, or no address, it acts as nothing.
 *
 * A seller id used to act as the store's first live member, its owner, for any
 * login holding it: an invited member given the seller id by the old backfill
 * acted as the owner, and kept doing so after being removed (follow-up review,
 * measured on Postgres). Read without `deleted_at`, a removed member's tokens
 * listed the store's orders with customers' addresses and changed its
 * playbook, and a closed store's members still got 200 on `/v1/seller/**`.
 */

type Rows<T> = { rows?: T[] }

export type SellerActor = { sellerId: string; memberId: string }

/** The store a member acts for: its own, while neither it nor the store is deleted. */
export async function liveSellerIdOfMember(
  scope: MedusaContainer,
  memberId: string
): Promise<string | null> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result: Rows<{ seller_id: string }> = await pg.raw(
    `SELECT m.seller_id
       FROM member m
       JOIN seller s ON s.id = m.seller_id
      WHERE m.id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL
      LIMIT 1`,
    [memberId]
  )
  return result.rows?.[0]?.seller_id ?? null
}

/** A login's own address: the entity_id of its emailpass provider identity, or null. */
export async function loginAddressOf(
  scope: MedusaContainer,
  authIdentityId: string | null | undefined
): Promise<string | null> {
  if (!authIdentityId) {
    return null
  }
  const [identity] = await scope
    .resolve(Modules.AUTH)
    .listAuthIdentities({ id: [authIdentityId] }, { relations: ["provider_identities"] })
  const address = identity?.provider_identities?.find((p) => p.provider === "emailpass")?.entity_id
  return typeof address === "string" && address.trim() ? address : null
}

/**
 * The live member of a live store whose email is this address, trimmed and
 * ignoring case; the earliest made if several share it.
 */
export async function liveMemberAtAddress(
  scope: MedusaContainer,
  sellerId: string,
  address: string
): Promise<string | null> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result: Rows<{ id: string }> = await pg.raw(
    `SELECT m.id
       FROM member m
       JOIN seller s ON s.id = m.seller_id
      WHERE m.seller_id = ?
        AND m.deleted_at IS NULL AND s.deleted_at IS NULL
        AND LOWER(TRIM(m.email)) = LOWER(TRIM(?))
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 1`,
    [sellerId, address]
  )
  return result.rows?.[0]?.id ?? null
}

/** The store and member a seller actor acts as, for this login, or null. */
export async function resolveSellerActor(
  scope: MedusaContainer,
  actorId: string | null | undefined,
  authIdentityId: string | null | undefined
): Promise<SellerActor | null> {
  if (typeof actorId !== "string" || !actorId) {
    return null
  }
  if (actorId.startsWith("mem_")) {
    const sellerId = await liveSellerIdOfMember(scope, actorId)
    return sellerId ? { sellerId, memberId: actorId } : null
  }
  if (actorId.startsWith("sel_")) {
    const address = await loginAddressOf(scope, authIdentityId)
    if (!address) {
      return null
    }
    const memberId = await liveMemberAtAddress(scope, actorId, address)
    return memberId ? { sellerId: actorId, memberId } : null
  }
  return null
}

/** For the gates: the live store a seller actor acts for, for this login, or null. */
export async function liveSellerIdForActor(
  scope: MedusaContainer,
  actorId: string | null | undefined,
  authIdentityId: string | null | undefined
): Promise<string | null> {
  return (await resolveSellerActor(scope, actorId, authIdentityId))?.sellerId ?? null
}

/** The fields of a vendor request this module reads. */
type VendorRequestLike = {
  scope: MedusaContainer
  auth_context?: { auth_identity_id?: string }
  _seller_id?: string
  _sellerContextResolved?: boolean
}

/**
 * For a route behind the vendor gate: the store of the actor it was handed.
 *
 * ensureSellerContext resolves a seller-id actor by the rule above and hands
 * the store on as `_seller_id`, so that value, in a request the gate let
 * through, is taken as it is. Any other actor is resolved here by the same
 * rule.
 */
export async function sellerIdForVendorActor(
  req: VendorRequestLike,
  actorId: string | null | undefined
): Promise<string | undefined> {
  if (!actorId) {
    return undefined
  }
  if (actorId === req._seller_id && req._sellerContextResolved === true) {
    return actorId
  }
  return (await liveSellerIdForActor(req.scope, actorId, req.auth_context?.auth_identity_id)) ?? undefined
}
