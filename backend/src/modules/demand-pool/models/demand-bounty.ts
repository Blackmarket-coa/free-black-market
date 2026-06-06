import { model } from "@medusajs/framework/utils"

export enum BountyObjective {
  FIND_SUPPLIER = "FIND_SUPPLIER",
  NEGOTIATE_PRICE = "NEGOTIATE_PRICE",
  RECRUIT_BUYERS = "RECRUIT_BUYERS",
  COORDINATE_LOGISTICS = "COORDINATE_LOGISTICS",
  FINALIZE_DEAL = "FINALIZE_DEAL",
  // Producer→creator marketing bounties (FBM Bounty Integration).
  CREATOR_NEEDED = "CREATOR_NEEDED",
  MARKETING_NEEDED = "MARKETING_NEEDED",
  PHOTOGRAPHY_NEEDED = "PHOTOGRAPHY_NEEDED",
}

export enum BountyStatus {
  ACTIVE = "ACTIVE",
  MILESTONE_PARTIAL = "MILESTONE_PARTIAL",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum BountyVisibility {
  PUBLIC = "PUBLIC",
  RESTRICTED = "RESTRICTED",
}

const DemandBounty = model.define("demand_bounty", {
  id: model.id().primaryKey(),

  demand_post_id: model.text(),
  contributor_id: model.text(),
  contributor_type: model.enum(["CUSTOMER", "SELLER"]).default("CUSTOMER"),

  // Bounty details
  objective: model.enum(Object.values(BountyObjective)),
  amount: model.bigNumber(),
  currency_code: model.text().default("USD"),

  // Escrow
  escrowed: model.boolean().default(false),
  escrow_ledger_entry_id: model.text().nullable(),

  // Milestones for payout
  milestones: model.json().nullable(),
  milestones_completed: model.number().default(0),
  amount_paid_out: model.bigNumber().default(0),

  // Assignee (who earns the bounty)
  assignee_id: model.text().nullable(),
  assignee_type: model.enum(["CUSTOMER", "SELLER", "ORGANIZER"]).nullable(),

  status: model
    .enum(Object.values(BountyStatus))
    .default(BountyStatus.ACTIVE),
  visibility: model
    .enum(Object.values(BountyVisibility))
    .default(BountyVisibility.PUBLIC),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["demand_post_id"], name: "IDX_bounty_demand_post" },
  { on: ["contributor_id"], name: "IDX_bounty_contributor" },
  { on: ["objective"], name: "IDX_bounty_objective" },
  { on: ["status"], name: "IDX_bounty_status" },
  { on: ["assignee_id"], name: "IDX_bounty_assignee" },
])

export default DemandBounty
