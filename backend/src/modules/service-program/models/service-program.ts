import { model } from "@medusajs/framework/utils"

export enum ServiceCategory {
  APPAREL_PRESS = "apparel_press",
  PACKAGING = "packaging",
  PHOTOGRAPHY = "photography",
  DESIGN = "design",
  FULFILLMENT = "fulfillment",
  COURIER = "courier",
  REPAIR = "repair",
  FABRICATION = "fabrication",
  CO_PACKING = "co_packing",
  ASSEMBLY = "assembly",
  CUSTOM = "custom",
}

export enum ServiceProgramType {
  BOUNTY_OPEN = "bounty_open",       // any qualifying service-vendor can claim
  BOUNTY_INVITE = "bounty_invite",   // vendor pre-selects service vendors
  FIXED_CONTRACT = "fixed_contract", // single-service-vendor contract
  THROUGHPUT_POOL = "throughput_pool", // shared pool by output volume
  ORDER_SUBCONTRACT = "order_subcontract", // tied to specific orders
}

export enum ServiceProgramStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  PAUSED = "paused",
  CLOSED = "closed",
  ARCHIVED = "archived",
}

export enum ServicePricingModel {
  PER_UNIT = "per_unit",
  PER_HOUR = "per_hour",
  FLAT = "flat",
  TIERED = "tiered",
}

const ServiceProgram = model
  .define("service_program", {
    id: model.id().primaryKey(),

    vendor_id: model.text(),
    title: model.text(),
    slug: model.text(),
    description: model.text().nullable(),
    deliverable_spec: model.json().nullable(), // file specs, dimensions, materials, tolerances
    acceptance_criteria: model.json().nullable(), // what counts as "done"

    service_category: model.enum(Object.values(ServiceCategory)),
    program_type: model.enum(Object.values(ServiceProgramType)),
    pricing_model: model.enum(Object.values(ServicePricingModel)),
    status: model
      .enum(Object.values(ServiceProgramStatus))
      .default(ServiceProgramStatus.DRAFT),

    // Pricing
    unit_price_cents: model.number().nullable(),
    hourly_rate_cents: model.number().nullable(),
    flat_price_cents: model.number().nullable(),
    pool_total_cents: model.number().nullable(),
    currency_code: model.text().default("usd"),

    // Capacity
    min_units: model.number().nullable(),
    max_units: model.number().nullable(),
    units_committed: model.number().default(0),

    // Lifecycle
    deadline_at: model.dateTime().nullable(),
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    budget_cap_cents: model.number().nullable(),
    escrow_amount_cents: model.number().default(0),

    // Gating
    requires_kyc: model.boolean().default(false),
    min_verification_level: model.text().nullable(),
    geo_allowlist: model.json().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["vendor_id"],
      name: "IDX_service_program_vendor",
    },
    {
      on: ["service_category"],
      name: "IDX_service_program_category",
    },
    {
      on: ["status"],
      name: "IDX_service_program_status",
    },
    {
      on: ["vendor_id", "slug"],
      name: "UQ_service_program_vendor_slug",
      unique: true,
    },
  ])

export default ServiceProgram
