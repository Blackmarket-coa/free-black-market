import { model } from "@medusajs/framework/utils"

/**
 * Canonical storefront/backend event row. Written by the
 * `POST /store/analytics/events` ingest endpoint and by server-side
 * subscribers that want to log a discrete user/funnel event with creator
 * + UTM context attached.
 *
 * The `event_name` field is intentionally free-form text — validation
 * against an allowlist happens at the ingest API boundary so server-side
 * emitters can adopt new event names without a schema change.
 */
const AnalyticsEvent = model
  .define("analytics_event", {
    id: model.id().primaryKey(),

    event_name: model.text(),

    visitor_token: model.text().nullable(),
    customer_id: model.text().nullable(),

    creator_seller_id: model.text().nullable(),
    affiliate_short_code: model.text().nullable(),
    affiliate_link_id: model.text().nullable(),

    order_id: model.text().nullable(),
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    utm_source: model.text().nullable(),
    utm_medium: model.text().nullable(),
    utm_campaign: model.text().nullable(),
    utm_content: model.text().nullable(),

    path: model.text().nullable(),
    referrer: model.text().nullable(),
    device_type: model.text().nullable(),
    country: model.text().nullable(),

    payload: model.json().nullable(),

    occurred_at: model.dateTime(),
  })
  .indexes([
    {
      on: ["event_name", "occurred_at"],
      name: "IDX_analytics_event_name_time",
    },
    {
      on: ["creator_seller_id", "occurred_at"],
      name: "IDX_analytics_event_creator_time",
    },
    {
      on: ["visitor_token", "occurred_at"],
      name: "IDX_analytics_event_visitor_time",
    },
    {
      on: ["affiliate_short_code", "occurred_at"],
      name: "IDX_analytics_event_short_code_time",
    },
  ])

export default AnalyticsEvent
