import { model } from "@medusajs/framework/utils"

export enum WebhookDeliveryStatus {
  PENDING = "pending",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  DEAD = "dead",
}

const WebhookDelivery = model
  .define("marketplace_webhook_delivery", {
    id: model.id().primaryKey(),

    subscription_id: model.text(),
    event: model.text(),
    payload: model.json(),

    // Stable per-logical-event id for the Blackout outbound channel (§1).
    // Blackout dedupes on (provider, eventId); we dedupe on this column so a
    // re-emit of the same logical event never produces a second delivery.
    // Null for per-seller deliveries, which key idempotency off `id`.
    event_id: model.text().nullable(),

    attempt: model.number().default(0),
    status: model
      .enum(Object.values(WebhookDeliveryStatus))
      .default(WebhookDeliveryStatus.PENDING),

    response_code: model.number().nullable(),
    response_body: model.text().nullable(),

    next_attempt_at: model.dateTime().nullable(),
    delivered_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["subscription_id"],
      name: "IDX_marketplace_webhook_delivery_subscription_id",
    },
    {
      on: ["status", "next_attempt_at"],
      name: "IDX_marketplace_webhook_delivery_status_next",
    },
    {
      on: ["event_id"],
      name: "IDX_marketplace_webhook_delivery_event_id",
      unique: true,
      where: "event_id IS NOT NULL",
    },
  ])

export default WebhookDelivery
