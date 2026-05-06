import { model } from "@medusajs/framework/utils"

export enum PromoCodeBindingPriority {
  OVERRIDE_LINK = "override_link",
  FALLBACK = "fallback",
  TIE_BREAKER = "tie_breaker",
}

export enum PromoCodeBindingStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  REVOKED = "revoked",
}

const PromoCodeBinding = model
  .define("promo_code_binding", {
    id: model.id().primaryKey(),

    promotion_id: model.text(),
    promotion_code: model.text().unique(),

    creator_seller_id: model.text(),
    deal_id: model.text().nullable(),
    program_id: model.text().nullable(),
    vendor_id: model.text().nullable(),

    attribution_priority: model
      .enum(Object.values(PromoCodeBindingPriority))
      .default(PromoCodeBindingPriority.OVERRIDE_LINK),

    status: model
      .enum(Object.values(PromoCodeBindingStatus))
      .default(PromoCodeBindingStatus.ACTIVE),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["creator_seller_id"],
      name: "IDX_promo_binding_creator",
    },
    {
      on: ["promotion_id"],
      name: "IDX_promo_binding_promotion",
    },
  ])

export default PromoCodeBinding
