import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The values a store's own rows can hold in a store column: the store's id,
 * and the id of every member of the store, removed members included.
 *
 * Until SD-145 the vendor routes wrote the acting member's id (`mem_`) where
 * the store's id belonged, and `scripts/rekey-member-keyed-store-data.ts`
 * moves those rows onto the store only when its `apply` is run; it leaves a
 * row whose member id matches no member at all. A route that matched the
 * store id alone treated the store's own legacy rows as another store's
 * (SD-158 review, measured): the nursery POST "took over" and emptied the
 * store's own attribute row, and the cycle POST answered 409 on the store's
 * own listing. The mapping is the rekey script's: a member id belongs to the
 * member row's `seller_id`, whether or not the member has been removed
 * (Mercur's deleteMemberStep soft-deletes it). A member id that matches no
 * member belongs to no store and so is never the caller's.
 */
export async function storeKeysOf(scope: MedusaContainer, sellerId: string): Promise<string[]> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result: { rows?: Array<{ id: string }> } = await pg.raw(
    `SELECT m.id FROM member m WHERE m.seller_id = ? ORDER BY m.id`,
    [sellerId]
  )
  return [sellerId, ...(result.rows ?? []).map((row) => row.id)]
}
