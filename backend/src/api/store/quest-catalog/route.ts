import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { QUEST_DEFINITIONS } from "../../../modules/vendor-quest/definitions"
import { VENDOR_ADDON_CATALOG } from "../../../modules/vendor-plan/addons"
import { VENDOR_PLAN_CATALOG } from "../../../modules/vendor-plan/catalog"

/**
 * GET /store/quest-catalog
 *
 * The vendor quest catalog, published.
 *
 * The Vendor Quest Engine turns a vendor's real operating history into an
 * exportable packet for a real-world gatekeeper — an FSA loan officer, a grant
 * committee, a wholesale buyer. Nothing at Etsy, Amazon or Shopify does this,
 * and until now it was invisible to anyone who had not already signed up, paid
 * for it, and had the feature flag switched on.
 *
 * Pure config. `getCatalog()` on the vendor side is explicitly "no vendor
 * data", and this route reads the same definitions, so publishing it exposes
 * nothing about any seller.
 *
 * Deliberately reports its own gating. Quests need `FF_VENDOR_QUESTS_V1` plus
 * the `vendor.quests` plan feature — the Scale plan or the Readiness Quests
 * add-on. A catalog page that showed thirteen quests without saying that would
 * be the next overclaim in a body of work about not making those.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const quests = QUEST_DEFINITIONS.map((definition) => ({
    key: definition.key,
    category: definition.category,
    title: definition.title,
    outcome: definition.outcome,
    type: definition.type,
    gatekeeper: definition.gatekeeper.name,
    gatekeeper_links: definition.gatekeeper.links ?? [],
    // Whether the quest ends in something a vendor can hand to someone. The
    // internal-unlock quests (trust tier, commons contribution) do not.
    has_packet: Boolean(definition.packetTemplate),
    stages: [...definition.stageGates]
      .sort((a, b) => a.order - b.order)
      .map((gate) => ({ key: gate.key, label: gate.label })),
    // Requirement tags matter to a vendor deciding whether a quest is worth it:
    // `platform` and `assisted` are what FBM can evidence from their history;
    // `vendor-supplied` and `outside-fbm` are work only they can do.
    requirement_counts: definition.requirements.reduce<Record<string, number>>(
      (counts, requirement) => {
        counts[requirement.tag] = (counts[requirement.tag] ?? 0) + 1
        return counts
      },
      {}
    ),
  }))

  const plans = VENDOR_PLAN_CATALOG.filter((plan) =>
    plan.feature_keys.includes("vendor.quests")
  ).map((plan) => ({
    code: plan.code,
    display_name: plan.display_name,
    price_amount: plan.price_amount,
    currency_code: plan.currency_code,
    interval: plan.interval,
  }))

  const addons = VENDOR_ADDON_CATALOG.filter(
    (addon) => addon.is_active && addon.feature_keys.includes("vendor.quests")
  ).map((addon) => ({
    code: addon.code,
    display_name: addon.display_name,
    price_amount: addon.price_amount,
    currency_code: addon.currency_code,
    duration_days: addon.duration_days,
  }))

  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  res.json({
    quests,
    categories: Array.from(new Set(quests.map((quest) => quest.category))),
    access: { plans, addons },
  })
}
