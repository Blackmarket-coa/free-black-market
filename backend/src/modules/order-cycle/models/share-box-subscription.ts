import { model } from "@medusajs/framework/utils"

/**
 * Share Box Subscription
 *
 * A member's standing subscription to a share-box template. The
 * scheduler generates one ShareBox per open order cycle for each
 * subscription whose status is `active` and whose template's
 * coordinator matches the cycle's coordinator.
 *
 * `customer_id` and `customer_external_id` (MXID) follow the same
 * dual-key pattern used by the entitlement module so subscriptions
 * can be created from either Matrix-side or Medusa-side identities.
 */
const ShareBoxSubscription = model.define("share_box_subscription", {
  id: model.id().primaryKey(),

  share_box_template_id: model.text(),

  customer_id: model.text().nullable(),
  customer_external_id: model.text().nullable(),

  status: model
    .enum(["active", "paused", "cancelled"])
    .default("active"),

  // Member-specific overrides. `slot_overrides` is a sparse map of
  // { [slot_key]: { candidate_variant_ids?: string[], skip?: boolean } }
  // applied on top of the template's slot definitions when the
  // scheduler generates the box.
  slot_overrides: model.json().nullable(),

  // First/last cycle this subscription should be considered for.
  starts_at: model.dateTime().nullable(),
  ends_at: model.dateTime().nullable(),

  pause_until: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),
  cancelled_reason: model.text().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    {
      name: "IDX_SBS_TEMPLATE",
      on: ["share_box_template_id"],
    },
    {
      name: "IDX_SBS_CUSTOMER",
      on: ["customer_id", "status"],
    },
    {
      name: "IDX_SBS_EXTERNAL",
      on: ["customer_external_id", "status"],
    },
    {
      name: "UQ_SBS_TEMPLATE_CUSTOMER",
      on: ["share_box_template_id", "customer_id"],
      unique: true,
    },
    {
      name: "UQ_SBS_TEMPLATE_EXTERNAL",
      on: ["share_box_template_id", "customer_external_id"],
      unique: true,
    },
  ])

export default ShareBoxSubscription
