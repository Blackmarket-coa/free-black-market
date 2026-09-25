import { model } from "@medusajs/framework/utils"

/**
 * Blackstar shipment placeholder. Holds the three identifiers Blackstar
 * (the BMC physical-fulfillment sibling) is expected to provide once it
 * comes online: `fulfillment_node_id`, `pickup_point_id`, `vending_machine_id`.
 *
 * Written on `order.fulfillment_created` for a fulfillment on the Blackstar
 * provider (`subscribers/emit-blackstar-delivery-option-selected.ts`), so
 * only while that provider is registered (FBM_BLACKSTAR_INTEGRATION=1). The
 * row is written whether or not the outbound Blackstar channel is configured.
 */
const BlackstarShipment = model
  .define("blackstar_shipment", {
    id: model.id().primaryKey(),

    order_id: model.text(),
    fulfillment_id: model.text().nullable(),

    fulfillment_node_id: model.text().nullable(),
    pickup_point_id: model.text().nullable(),
    vending_machine_id: model.text().nullable(),

    external_status: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["order_id"],
      name: "IDX_blackstar_shipment_order",
    },
    {
      on: ["fulfillment_id"],
      name: "IDX_blackstar_shipment_fulfillment",
    },
    {
      on: ["fulfillment_node_id"],
      name: "IDX_blackstar_shipment_node",
    },
  ])

export default BlackstarShipment
