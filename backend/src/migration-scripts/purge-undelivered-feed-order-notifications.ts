import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * One-off: delete the notification rows the old order-placed subscriber left.
 *
 * Until the order confirmation moved to the email channel, every
 * `order.placed` called `createNotifications({ channel: "feed", template:
 * "order.placed", data: { ..., billing_address } })`. No provider is
 * registered for `feed`, so nothing was ever sent — but Medusa's notification
 * module writes the row before it looks for a provider, then marks it
 * FAILURE. Each one holds the buyer's email, first and last name and full
 * billing address, kept for nothing: there is no delivery to audit, and the
 * rows carry no `receiver_id`, so the customer-data registry cannot reach
 * them on an erasure request.
 *
 * Scoped to exactly those rows: the `feed` channel, the old template name, and
 * any status but `success` (none can be `success`, as no `feed` provider was
 * ever configured; the guard keeps a delivered row if one somehow exists).
 * Mercur's own `feed` rows use other templates and are untouched. Medusa runs
 * each migration script once (`medusa db:migrate`, `script_migrations`).
 */
export const PURGE_UNDELIVERED_FEED_ORDER_NOTIFICATIONS_SQL = `
  DELETE FROM "notification"
  WHERE "channel" = 'feed'
    AND "template" = 'order.placed'
    AND "status" <> 'success'
`

type Pg = { raw: (sql: string) => Promise<{ rowCount?: number | null }> }
type Logger = { info: (message: string) => void }

export default async function purgeUndeliveredFeedOrderNotifications({
  container,
}: {
  container: MedusaContainer
}): Promise<void> {
  const pg = container.resolve<Pg>(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const result = await pg.raw(PURGE_UNDELIVERED_FEED_ORDER_NOTIFICATIONS_SQL)
  logger.info(
    `purge-undelivered-feed-order-notifications: deleted ${result?.rowCount ?? 0} undelivered order.placed feed notifications`
  )
}
