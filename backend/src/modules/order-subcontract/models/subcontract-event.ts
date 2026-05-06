import { model } from "@medusajs/framework/utils"

export enum SubcontractEventType {
  PROPOSED = "proposed",
  ACCEPTED = "accepted",
  MATERIALS_RECEIVED = "materials_received",
  PRODUCTION_STARTED = "production_started",
  QC_PASSED = "qc_passed",
  SHIPPED = "shipped",
  DELIVERED = "delivered",
  ACCEPTED_BY_PARENT = "accepted_by_parent",
  DAMAGED = "damaged",
  REWORK_REQUESTED = "rework_requested",
  DISPUTED = "disputed",
  RESOLVED = "resolved",
  CANCELED = "canceled",
}

const SubcontractEvent = model
  .define("subcontract_event", {
    id: model.id().primaryKey(),

    subcontract_id: model.text(),
    event_type: model.enum(Object.values(SubcontractEventType)),
    actor_seller_id: model.text().nullable(),
    proof_id: model.text().nullable(),
    note: model.text().nullable(),
    occurred_at: model.dateTime(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["subcontract_id", "occurred_at"],
      name: "IDX_subcontract_event_subcontract_time",
    },
  ])

export default SubcontractEvent
