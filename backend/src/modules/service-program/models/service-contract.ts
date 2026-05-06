import { model } from "@medusajs/framework/utils"

export enum ServiceContractStatus {
  ACTIVE = "active",
  IN_PROGRESS = "in_progress",
  DELIVERED = "delivered",
  ACCEPTED = "accepted",
  DISPUTED = "disputed",
  CANCELED = "canceled",
}

const ServiceContract = model
  .define("service_contract", {
    id: model.id().primaryKey(),

    program_id: model.text(),
    application_id: model.text(),
    service_seller_id: model.text(),
    vendor_id: model.text(),

    status: model
      .enum(Object.values(ServiceContractStatus))
      .default(ServiceContractStatus.ACTIVE),

    effective_from: model.dateTime(),
    effective_until: model.dateTime().nullable(),

    // Frozen terms snapshot at acceptance time
    terms_snapshot: model.json(),

    // Milestones: array of { id, title, percent_of_total, due_at, status,
    //                       proof_id?, released_at? }
    milestones: model.json().nullable(),

    // Backing escrow (in hawala-ledger)
    escrow_ledger_entry_id: model.text().nullable(),
    escrow_amount_cents: model.number().default(0),

    total_units_delivered: model.number().default(0),
    total_paid_cents: model.bigNumber().default(0),

    dispute_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["service_seller_id", "status"],
      name: "IDX_service_contract_seller_status",
    },
    {
      on: ["vendor_id", "status"],
      name: "IDX_service_contract_vendor_status",
    },
    {
      on: ["program_id"],
      name: "IDX_service_contract_program",
    },
  ])

export default ServiceContract
