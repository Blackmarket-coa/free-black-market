import { model } from "@medusajs/framework/utils"

export enum ServiceApplicationStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
}

const ServiceApplication = model
  .define("service_application", {
    id: model.id().primaryKey(),

    program_id: model.text(),
    service_seller_id: model.text(), // the service-providing vendor

    proposed_unit_price_cents: model.number().nullable(),
    proposed_capacity: model.number().nullable(),
    proposed_lead_time_days: model.number().nullable(),
    sample_portfolio_urls: model.json().nullable(), // string[]
    pitch: model.text().nullable(),

    status: model
      .enum(Object.values(ServiceApplicationStatus))
      .default(ServiceApplicationStatus.PENDING),
    decided_at: model.dateTime().nullable(),
    decided_by: model.text().nullable(),
    decision_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["program_id"],
      name: "IDX_service_application_program",
    },
    {
      on: ["service_seller_id"],
      name: "IDX_service_application_service_seller",
    },
    {
      on: ["program_id", "service_seller_id"],
      name: "UQ_service_application",
      unique: true,
    },
  ])

export default ServiceApplication
