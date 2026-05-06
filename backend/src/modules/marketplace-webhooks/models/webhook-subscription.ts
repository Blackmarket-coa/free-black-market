import { model } from "@medusajs/framework/utils"

export enum WebhookSubscriptionStatus {
  ACTIVE = "active",
  DISABLED = "disabled",
}

export const MARKETPLACE_WEBHOOK_EVENTS = [
  "creator.payout.completed",
  "listing.signed_bundle.published",
  "creator.account.suspended",
  "creator.commission.earned",
  "creator.commission.held",
  "creator.commission.approved",
  "creator.commission.reversed",
  "creator.commission.disqualified",
  "creator.attribution.fraud_flagged",
] as const

export type MarketplaceWebhookEvent = (typeof MARKETPLACE_WEBHOOK_EVENTS)[number]

const WebhookSubscription = model
  .define("marketplace_webhook_subscription", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    url: model.text(),
    secret: model.text(),
    events: model.json(),

    status: model
      .enum(Object.values(WebhookSubscriptionStatus))
      .default(WebhookSubscriptionStatus.ACTIVE),

    failure_count: model.number().default(0),
    last_attempt_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["seller_id"],
      name: "IDX_marketplace_webhook_subscription_seller_id",
    },
    {
      on: ["status"],
      name: "IDX_marketplace_webhook_subscription_status",
    },
  ])

export default WebhookSubscription
