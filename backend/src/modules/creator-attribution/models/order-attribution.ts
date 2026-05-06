import { model } from "@medusajs/framework/utils"

export enum AttributionSource {
  LINK_CLICK = "link_click",
  PROMO_CODE = "promo_code",
  DIRECT_LANDING = "direct_landing",
  EMBED_WIDGET = "embed_widget",
}

export enum AttributionModel {
  LAST_CLICK = "last_click",
  FIRST_CLICK = "first_click",
  LINEAR = "linear",
}

export enum CommissionStatus {
  PENDING = "pending",
  HELD = "held",
  APPROVED = "approved",
  PAID = "paid",
  REVERSED = "reversed",
  DISQUALIFIED = "disqualified",
}

const OrderAttribution = model
  .define("order_attribution", {
    id: model.id().primaryKey(),

    order_id: model.text().unique(),
    customer_id: model.text().nullable(),
    creator_seller_id: model.text(),
    affiliate_link_id: model.text().nullable(),
    promo_code_binding_id: model.text().nullable(),
    deal_id: model.text().nullable(),
    program_id: model.text().nullable(),
    vendor_id: model.text().nullable(),

    source: model.enum(Object.values(AttributionSource)),
    attribution_model: model
      .enum(Object.values(AttributionModel))
      .default(AttributionModel.LAST_CLICK),

    click_event_id: model.text().nullable(),
    cookie_window_days: model.number().default(7),
    attribution_decided_at: model.dateTime(),

    attributed_subtotal_cents: model.bigNumber(),
    commission_basis_cents: model.bigNumber(),
    commission_amount_cents: model.bigNumber(),
    commission_percent: model.number().nullable(),
    currency_code: model.text().default("usd"),

    commission_status: model
      .enum(Object.values(CommissionStatus))
      .default(CommissionStatus.PENDING),
    hold_until: model.dateTime().nullable(),
    ledger_entry_id: model.text().nullable(),

    disqualified_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id", "commission_status"],
      name: "IDX_order_attribution_creator_status",
    },
    {
      on: ["program_id"],
      name: "IDX_order_attribution_program",
    },
    {
      on: ["deal_id"],
      name: "IDX_order_attribution_deal",
    },
    {
      on: ["commission_status", "hold_until"],
      name: "IDX_order_attribution_status_hold",
    },
  ])

export default OrderAttribution
