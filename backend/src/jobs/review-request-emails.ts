import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const DEFAULT_REGION = (
  process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"
).toLowerCase()

function storefrontBase(): string {
  const explicit = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL
  if (explicit) return explicit.replace(/\/$/, "")
  return "https://freeblackmarket.com"
}

/**
 * Post-purchase review request emails.
 *
 * Runs daily and targets orders placed 72–96h ago — a fixed 24h-wide window
 * matching the daily cadence, so each order is emailed on exactly one run
 * (natural idempotency without a "sent" marker). Off by default; enable with
 * ENABLE_REVIEW_REQUESTS=true so it never spams unless a deployment opts in.
 */
export default async function reviewRequestEmailsJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  if (process.env.ENABLE_REVIEW_REQUESTS !== "true") {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notification = container.resolve("notification") as any

  const now = Date.now()
  const windowStart = new Date(now - 96 * 3_600_000)
  const windowEnd = new Date(now - 72 * 3_600_000)

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "email", "created_at", "items.title", "customer.first_name"],
      filters: {
        created_at: { $gte: windowStart, $lt: windowEnd },
      } as any,
    })

    if (!orders?.length) {
      logger.info("[review-request-emails] no orders in window")
      return
    }

    let sent = 0
    for (const order of orders) {
      if (!order.email) continue
      const reviewUrl = `${storefrontBase()}/${DEFAULT_REGION}/review?order_id=${order.id}`
      try {
        await notification.createNotifications({
          to: order.email,
          channel: "email",
          template: "review-request",
          data: {
            customer_name: (order as any).customer?.first_name ?? null,
            product_title: (order as any).items?.[0]?.title ?? null,
            review_url: reviewUrl,
          },
        })
        sent++
      } catch (err) {
        logger.warn(`[review-request-emails] send failed for ${order.id}: ${err}`)
      }
    }
    logger.info(`[review-request-emails] sent ${sent}/${orders.length}`)
  } catch (error: any) {
    logger.error(`[review-request-emails] job failed: ${error?.message || error}`)
  }
}

export const config = {
  name: "review-request-emails",
  schedule: "0 14 * * *", // daily at 14:00 UTC
}
