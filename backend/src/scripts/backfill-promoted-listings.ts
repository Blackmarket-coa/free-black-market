import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { grantPromotion } from "../shared/promoted-listing-service"
import { getPromotionState } from "../shared/promoted-listing-service"

/**
 * Adopt hand-set `featured` flags into the promotion model.
 *
 * Every `featured` row today was set through the admin form, before promoted
 * listings were an entitlement. The expiry sweep deliberately will not clear
 * them — a background job silently demoting vendors from the public directory
 * is not an acceptable way to migrate — so they sit in limbo: featured, but
 * with no record of why or until when.
 *
 * This grants each of them an **open-ended** promotion (null expiry), which
 * preserves their placement exactly while making the entitlement the single
 * source of truth. After it runs, every featured seller has a record and the
 * sweep's `unbacked` count is zero.
 *
 * Open-ended rather than dated on purpose: nobody knows what these vendors were
 * promised, and inventing an expiry would silently end placement that may have
 * been agreed indefinitely. An operator can shorten any of them afterwards with
 * `POST /admin/sellers/:id/promotion`.
 *
 *   npx medusa exec ./src/scripts/backfill-promoted-listings.ts
 *   npx medusa exec ./src/scripts/backfill-promoted-listings.ts --dry-run
 */
export default async function backfillPromotedListings({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const dryRun = (args ?? []).includes("--dry-run")

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: rows } = await query.graph({
    entity: "seller_metadata",
    fields: ["seller_id"],
    filters: { featured: true },
  })

  const featured = (rows ?? []) as { seller_id: string }[]
  logger.info(
    `[backfill-promoted-listings] ${featured.length} featured seller(s) found${
      dryRun ? " (dry run)" : ""
    }`
  )

  let adopted = 0
  let alreadyHeld = 0
  let failed = 0

  for (const row of featured) {
    try {
      const state = await getPromotionState(container, row.seller_id)
      // Idempotent: a seller who already holds a promotion is left alone, so
      // re-running never extends or duplicates anything.
      if (state.granted_at || state.expires_at) {
        alreadyHeld++
        continue
      }

      if (!dryRun) {
        await grantPromotion(container, {
          sellerId: row.seller_id,
          tierCode: null,
          reason: "backfill: featured before promotions were entitlements",
        })
      }
      adopted++
    } catch (error) {
      failed++
      logger.warn(
        `[backfill-promoted-listings] failed for ${row.seller_id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  logger.info(
    `[backfill-promoted-listings] adopted ${adopted}, already held ${alreadyHeld}, failed ${failed}`
  )
}
