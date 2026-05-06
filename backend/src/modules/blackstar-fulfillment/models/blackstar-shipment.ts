import { model } from "@medusajs/framework/utils"

/**
 * Blackstar shipment placeholder. Holds the three identifiers Blackstar
 * (the BMC physical-fulfillment sibling) is expected to provide once it
 * comes online: `fulfillment_node_id`, `pickup_point_id`, `vending_machine_id`.
 *
 * In stub mode (FBM_BLACKSTAR_INTEGRATION!=1) the row is still written so
 * the contract is exercised, but no external HTTP call happens.
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
