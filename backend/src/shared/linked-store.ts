import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The store a login is already linked to as a seller, read from
 * `app_metadata.seller_id`: a seller id (what approval writes) or a member id
 * (what Mercur's createSellerWorkflow writes for the member it creates, and
 * what an accepted invite writes for the new member).
 *
 * - `none`: the login has no seller link.
 * - `live`: the store exists. `memberId` is the member the link names, or
 *   null for a seller-id link.
 * - `closed`: the link names a store or member that is gone, or an id of
 *   neither kind.
 */
export type LinkedStore =
  | { kind: "none" }
  | {
      kind: "live"
      seller: { id: string; name: string; handle: string }
      memberId: string | null
    }
  | { kind: "closed"; actor: string }

type Rows<T> = { rows?: T[] }

export async function resolveLinkedStore(
  container: MedusaContainer,
  appMetadata: Record<string, unknown> | null | undefined
): Promise<LinkedStore> {
  const actor = appMetadata?.seller_id
  if (typeof actor !== "string" || !actor) {
    return { kind: "none" }
  }

  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let sellerId: string | null = null
  let memberId: string | null = null
  if (actor.startsWith("mem_")) {
    const member: Rows<{ seller_id: string | null }> = await pg.raw(
      `SELECT seller_id FROM member WHERE id = ? AND deleted_at IS NULL`,
      [actor]
    )
    sellerId = member.rows?.[0]?.seller_id ?? null
    memberId = sellerId ? actor : null
  } else if (actor.startsWith("sel_")) {
    sellerId = actor
  }
  if (!sellerId) {
    return { kind: "closed", actor }
  }

  const seller: Rows<{ id: string; name: string; handle: string }> = await pg.raw(
    `SELECT id, name, handle FROM seller WHERE id = ? AND deleted_at IS NULL`,
    [sellerId]
  )
  const found = seller.rows?.[0]
  return found ? { kind: "live", seller: found, memberId } : { kind: "closed", actor }
}

/**
 * Whether the store a login is linked to is the one an approval of this
 * application created and then failed to finish, so approval may resume onto
 * it.
 *
 * Its handle must be the one the application's store name makes, and its
 * owner member, the one Mercur created with the applicant's address, must be
 * the member the login is linked to (or, for a seller-id link, exist). A store
 * the login was invited into fails the second test even when its name matches:
 * an accepted invite leaves the invite's member, not an owner with this
 * address.
 */
export async function isUnfinishedApprovalOf(
  container: MedusaContainer,
  linked: Extract<LinkedStore, { kind: "live" }>,
  handle: string,
  applicantEmail: string
): Promise<boolean> {
  if (linked.seller.handle !== handle) {
    return false
  }
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const owners: Rows<{ id: string }> = await pg.raw(
    `SELECT id FROM member
      WHERE seller_id = ? AND deleted_at IS NULL AND role = 'owner'
        AND LOWER(email) = LOWER(?)`,
    [linked.seller.id, applicantEmail]
  )
  const ownerIds = (owners.rows ?? []).map((row) => row.id)
  return linked.memberId ? ownerIds.includes(linked.memberId) : ownerIds.length > 0
}
