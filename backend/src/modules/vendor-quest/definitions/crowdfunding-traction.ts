import type { QuestDefinition } from "../types"
import {
  disclaimer,
  lifetimeRevenueAtLeast,
  repeatCustomersAtLeast,
  hasCashFlowHistory,
} from "./shared"

/**
 * Q4 — Crowdfunding Traction Pack.
 */
const crowdfundingTraction: QuestDefinition = {
  key: "crowdfunding-traction",
  category: "Capital & Funding",
  title: "Crowdfunding Traction Pack",
  outcome: "Launch-ready campaign evidence (traction one-pager + metrics)",
  type: "individual",
  gatekeeper: {
    name: "the crowd / crowdfunding platform",
    disclaimer: disclaimer("The crowdfunding platform and its backers"),
    links: [],
  },
  usesFields: ["documents"],
  requirements: [
    { key: "revenue_trend", label: "Revenue trend", tag: "platform", satisfied: hasCashFlowHistory(2) },
    { key: "repeat_buyers", label: "Repeat-buyer proof", tag: "platform", satisfied: repeatCustomersAtLeast(1) },
    { key: "product_story", label: "Product story", tag: "assisted", note: "Drafted from your listings + record." },
    { key: "media", label: "Media / assets", tag: "vendor-supplied", note: "Upload campaign media to your vault." },
  ],
  stageGates: [
    {
      key: "traction",
      label: "Traction",
      order: 1,
      unlocks: (s) => lifetimeRevenueAtLeast(1)(s) && repeatCustomersAtLeast(1)(s),
      missing: (s) => {
        const out: string[] = []
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("At least one recorded sale")
        if (!repeatCustomersAtLeast(1)(s)) out.push("At least one repeat buyer")
        return out
      },
    },
    {
      key: "campaign_ready",
      label: "Campaign-Ready",
      order: 2,
      unlocks: (s) => hasCashFlowHistory(3)(s) && repeatCustomersAtLeast(5)(s),
      missing: (s) => {
        const out: string[] = []
        if (!hasCashFlowHistory(3)(s)) out.push("3 months of revenue trend")
        if (!repeatCustomersAtLeast(5)(s)) out.push("5 repeat buyers")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "traction-one-pager",
    title: "Traction One-Pager",
    sections: [
      {
        key: "metrics",
        title: "Traction Metrics",
        build: (s) => ({
          available: true,
          data: {
            lifetime_revenue: s.revenue.lifetime_revenue,
            monthly: s.revenue.monthly,
            distinct_customers: s.customers.distinct_customers,
            repeat_customers: s.customers.repeat_customers,
            repeat_rate: s.customers.repeat_rate,
          },
        }),
      },
    ],
    remainingItems: () => ["Campaign video / images", "Reward tiers", "Funding goal & timeline"],
  },
}

export default crowdfundingTraction
