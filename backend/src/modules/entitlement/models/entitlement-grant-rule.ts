import { model } from "@medusajs/framework/utils"
import { EntitlementKind } from "./entitlement"

/**
 * Vendor-defined declaration: "purchasing this product (or variant) grants
 * an entitlement with this feature_key, kind, and duration." Lets the
 * grant-on-order subscriber issue entitlements without code changes.
 */
const EntitlementGrantRule = model
  .define("entitlement_grant_rule", {
    id: model.id().primaryKey(),

    seller_id: model.text().nullable(),

    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    feature_key: model.text(),
    kind: model.enum(Object.values(EntitlementKind)).default(EntitlementKind.OTHER),

    duration_days: model.number().nullable(),

    enabled: model.boolean().default(true),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["product_id"],
      name: "IDX_entitlement_grant_rule_product",
    },
    {
      on: ["variant_id"],
      name: "IDX_entitlement_grant_rule_variant",
    },
    {
      on: ["seller_id"],
      name: "IDX_entitlement_grant_rule_seller",
    },
  ])

export default EntitlementGrantRule
