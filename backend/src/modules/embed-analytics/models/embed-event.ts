import { model } from "@medusajs/framework/utils"

/**
 * Embed Event
 *
 * A single analytics event emitted by connect.js (view, product view, add to
 * cart, checkout start, order complete, booking open/confirm, chat open).
 * Ingested in batches via `POST /store/embed/events`; `seller_id`/`key_id`/
 * `origin` are stamped server-side from the validated embed key, never trusted
 * from the client body.
 */
const EmbedEvent = model.define("embed_event", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  key_id: model.text().nullable(),
  origin: model.text().nullable(),
  session_id: model.text().nullable(),

  event_type: model.text(),
  product_id: model.text().nullable(),
  order_id: model.text().nullable(),

  // Free-form client context (path, referrer, value, currency, …).
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["seller_id"], name: "IDX_embed_event_seller_id" },
    { on: ["seller_id", "event_type"], name: "IDX_embed_event_seller_type" },
  ])

export default EmbedEvent
