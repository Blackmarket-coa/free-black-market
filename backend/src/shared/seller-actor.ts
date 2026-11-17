import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Which store a seller actor may act for.
 *
 * A seller token's actor, like a login's `app_metadata.seller_id`, is a member
 * id (`mem_`, what Mercur links) or a seller id (`sel_`, what approval links).
 * Mercur's deleteMemberStep soft-deletes a removed member and leaves the
 * login's link naming it, and signing in mints that member as the actor again.
 * Closing a store soft-deletes the seller and leaves its members' links too.
 * Read without `deleted_at`, such an actor still resolved to the store.
 * Measured on Postgres, a removed member's tokens, issued before the removal
 * or after it, listed the store's orders with the customer's address, its
 * products and its team, and changed its playbook. A member of a closed store
 * still got 200 on `/v1/seller/**`.
 *
 * So a member acts for its store only while neither the member nor the store
 * is deleted, and a seller id only while its store is not deleted.
 */

type Rows<T> = { rows?: T[] }

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

/** Whether a store exists and is not deleted. */
export async function isLiveSeller(scope: MedusaContainer, sellerId: string): Promise<boolean> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result: Rows<{ id: string }> = await pg.raw(
    `SELECT id FROM seller WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [sellerId]
  )
  return Boolean(result.rows?.[0])
}

/**
 * For the gates: the live store a member or seller actor acts for, or null
 * for any other id, a removed member, or a closed store.
 */
export async function liveSellerIdForActor(
  scope: MedusaContainer,
  actorId: string | null | undefined
): Promise<string | null> {
  if (typeof actorId !== "string" || !actorId) {
    return null
  }
  if (actorId.startsWith("mem_")) {
    return liveSellerIdOfMember(scope, actorId)
  }
  if (actorId.startsWith("sel_")) {
    return (await isLiveSeller(scope, actorId)) ? actorId : null
  }
  return null
}

/**
 * For a route behind the vendor gate: the store of the actor it was handed.
 *
 * ensureSellerContext has already refused a seller id whose store is closed,
 * and hands a live one on as `_seller_id`, so any id that is not a member's is
 * passed through as before. A member id is resolved here and only while the
 * member and its store are live: a removed member's id is no longer passed on
 * as if it named a store.
 */
export async function sellerIdForVendorActor(
  scope: MedusaContainer,
  actorId: string | null | undefined
): Promise<string | undefined> {
  if (!actorId) {
    return undefined
  }
  if (!actorId.startsWith("mem_")) {
    return actorId
  }
  return (await liveSellerIdOfMember(scope, actorId)) ?? undefined
}

/**
 * The member a seller-id actor acts as for Mercur's member-keyed guards: the
 * store's first member that is not deleted.
 */
export async function firstLiveMemberIdOf(
  scope: MedusaContainer,
  sellerId: string
): Promise<string | null> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result: Rows<{ id: string }> = await pg.raw(
    `SELECT id FROM member
      WHERE seller_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [sellerId]
  )
  return result.rows?.[0]?.id ?? null
}
