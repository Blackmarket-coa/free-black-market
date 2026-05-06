import { model } from "@medusajs/framework/utils"

/**
 * Customer-facing right or capability granted by a purchase, subscription,
 * manual admin action, or external integration. Consumed by Blackout (and
 * other BMC siblings) to gate features.
 */

export enum EntitlementStatus {
  ACTIVE = "active",
  PENDING = "pending",
  EXPIRED = "expired",
  REVOKED = "revoked",
}

export enum EntitlementSource {
  ORDER = "order",
  SUBSCRIPTION = "subscription",
  MANUAL = "manual",
  EXTERNAL = "external",
}

/**
 * Subset of ProductArchetypeCode values that are entitlement-bearing.
 * Mirrored as a plain string enum here to avoid coupling the entitlement
 * module to product-archetype's internal types.
 */
export enum EntitlementKind {
  DIGITAL = "digital",
  ACCESS_PASS = "access_pass",
  PLUGIN = "plugin",
  THEME = "theme",
  EMOJI_PACK = "emoji_pack",
  SERVICE = "service",
  OTHER = "other",
}

const Entitlement = model
  .define("entitlement", {
    id: model.id().primaryKey(),

    customer_id: model.text().nullable(),
    customer_external_id: model.text().nullable(),

    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    kind: model.enum(Object.values(EntitlementKind)).default(EntitlementKind.OTHER),
    feature_key: model.text(),

    status: model.enum(Object.values(EntitlementStatus)).default(EntitlementStatus.ACTIVE),
    source: model.enum(Object.values(EntitlementSource)).default(EntitlementSource.ORDER),

    source_order_id: model.text().nullable(),
    source_subscription_id: model.text().nullable(),

    granted_at: model.dateTime(),
    expires_at: model.dateTime().nullable(),
    revoked_at: model.dateTime().nullable(),
    revoked_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["customer_id", "status"],
      name: "IDX_entitlement_customer_status",
    },
    {
      on: ["customer_external_id", "feature_key"],
      name: "IDX_entitlement_external_feature",
    },
    {
      on: ["expires_at"],
      name: "IDX_entitlement_expires_at",
    },
    {
      on: ["source_order_id", "product_id"],
      name: "UQ_entitlement_source_order_product",
      unique: true,
    },
  ])

export default Entitlement
