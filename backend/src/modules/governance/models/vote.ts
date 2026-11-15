import { model } from "@medusajs/framework/utils"

/**
 * Garden Vote Model
 * 
 * Records an individual vote on a proposal. One live ballot per member per
 * proposal is enforced by the partial unique index below
 * (`Migration20261115210000AddUniqueBallotIndex`), not by the route's
 * "already voted" read, which concurrent requests all pass.
 */
export const GardenVote = model.define("garden_vote", {
  id: model.id().primaryKey(),
  proposal_id: model.text(),
  garden_id: model.text(),
  customer_id: model.text(),
  membership_id: model.text(),
  
  // The vote
  vote: model.enum(["for", "against", "abstain"]),
  
  // Voting power at time of vote
  voting_power: model.bigNumber(),
  
  // How voting power was calculated
  power_basis: model.json(), // { base, labor_hours, investment, roles }
  
  // Optional comment (may be public or private)
  comment: model.text().nullable(),
  comment_visibility: model.enum(["public", "members_only", "private"]).default("public"),
  
  // Delegation (if someone voted on their behalf)
  delegated_from_id: model.text().nullable(),
  is_delegated: model.boolean().default(false),
  
  // Can be changed until voting ends
  is_final: model.boolean().default(true),
  previous_vote: model.enum(["for", "against", "abstain"]).nullable(),
  
  voted_at: model.dateTime(),
  
  metadata: model.json().nullable(),
}).indexes([
  {
    on: ["proposal_id", "customer_id"],
    name: "IDX_garden_vote_proposal_customer_unique",
    unique: true,
    where: "deleted_at IS NULL",
  },
])
