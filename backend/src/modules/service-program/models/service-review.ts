import { model } from "@medusajs/framework/utils"

/**
 * A rating + written review a client (the contract's `vendor_id`) leaves for
 * the service provider (`service_seller_id`) after a contract reaches a
 * terminal-success state. One review per (contract, reviewer). Mirrors the
 * shape of the product-review pattern used elsewhere in the marketplace.
 */
const ServiceReview = model
  .define("service_review", {
    id: model.id().primaryKey(),

    contract_id: model.text(),
    program_id: model.text(),
    // The reviewed party (service provider).
    service_seller_id: model.text(),
    // The author of the review (the contract's client / vendor_id).
    reviewer_id: model.text(),

    rating: model.number(), // 1..5
    comment: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["service_seller_id"],
      name: "IDX_service_review_seller",
    },
    {
      on: ["program_id"],
      name: "IDX_service_review_program",
    },
    {
      // One review per reviewer per contract.
      on: ["contract_id", "reviewer_id"],
      unique: true,
      name: "UQ_service_review_contract_reviewer",
    },
  ])

export default ServiceReview
