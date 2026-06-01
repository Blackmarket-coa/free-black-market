import { model } from "@medusajs/framework/utils"
import { Stance } from "../stance"

/**
 * Character Sheet
 *
 * One row per customer — the unified "RPG profile" that ties together the
 * marketplace's many fragmented signals (orders, investments, volunteer time,
 * karma, vendor trust) into a single levelled identity.
 *
 * IMPORTANT — this table is a *derived cache*, not a source of truth. The
 * per-role XP/level fields are authoritative (they're the gamification-specific
 * fact that lives nowhere else), but the aggregate stat fields below are
 * snapshots recomputed from the owning modules (impact-metrics, collective-
 * campaign, volunteer, hawala-ledger, vendor-verification) via `query.graph`.
 * Never treat them as the canonical value — recompute from source.
 */
const CharacterSheet = model.define("character_sheet", {
  id: model.id().primaryKey(),

  // Link to customer (one sheet per customer)
  customer_id: model.text().unique(),

  // The role the user is currently "playing" — drives storefront theming.
  active_stance: model.enum(Object.values(Stance)).default(Stance.CONSUMER),

  // === Per-role XP + level (authoritative gamification state) ===
  producer_xp: model.number().default(0),
  producer_level: model.number().default(0),
  consumer_xp: model.number().default(0),
  consumer_level: model.number().default(0),
  investor_xp: model.number().default(0),
  investor_level: model.number().default(0),
  coalition_xp: model.number().default(0),
  coalition_level: model.number().default(0),
  creator_xp: model.number().default(0),
  creator_level: model.number().default(0),

  // Sum of all role XP — used for leaderboards / "overall level".
  total_xp: model.number().default(0),

  // === Aggregate stats snapshot (DERIVED — recomputed from source modules) ===
  // Value (cents) of food/goods produced and sold — from producer impact.
  food_produced_cents: model.bigNumber().default(0),
  // Orders completed as a buyer — mirrors buyer_impact.total_orders.
  orders_completed: model.number().default(0),
  // Capital deployed into campaigns/pools (cents) — from collective-campaign.
  capital_deployed_cents: model.bigNumber().default(0),
  // Mutual-aid / volunteer contributions count.
  mutual_aid_contributions: model.number().default(0),
  // Vendor trust score 0-100 — mirror of vendor_verification.trust_score.
  trust_score: model.number().default(0),
  // Sum of karma_event deltas — from hawala-ledger.
  karma: model.number().default(0),
  // Volunteer time credits accrued — from the volunteer module.
  time_credits: model.number().default(0),

  // Earned titles: { title_slug, role, earned_at }[]
  earned_titles: model.json().nullable(),

  // When the aggregate snapshot was last recomputed from source modules.
  last_recomputed_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["customer_id"], name: "IDX_character_sheet_customer_id" },
    { on: ["active_stance"], name: "IDX_character_sheet_active_stance" },
    { on: ["total_xp"], name: "IDX_character_sheet_total_xp" },
  ])

export default CharacterSheet
