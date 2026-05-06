import { model } from "@medusajs/framework/utils"

const AttributionClickEvent = model
  .define("attribution_click_event", {
    id: model.id().primaryKey(),

    short_code: model.text(),
    affiliate_link_id: model.text(),
    creator_seller_id: model.text(),

    visitor_token: model.text(),
    ip_hash: model.text().nullable(),
    user_agent_hash: model.text().nullable(),
    referrer: model.text().nullable(),
    country: model.text().nullable(),
    customer_id: model.text().nullable(),

    fingerprint: model.text().nullable(),
    is_bot_suspected: model.boolean().default(false),

    occurred_at: model.dateTime(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["visitor_token", "occurred_at"],
      name: "IDX_click_event_visitor_time",
    },
    {
      on: ["affiliate_link_id", "occurred_at"],
      name: "IDX_click_event_link_time",
    },
    {
      on: ["creator_seller_id", "occurred_at"],
      name: "IDX_click_event_creator_time",
    },
    {
      on: ["short_code"],
      name: "IDX_click_event_short_code",
    },
  ])

export default AttributionClickEvent
