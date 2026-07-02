import type { QuestDefinition } from "../types"
import {
  disclaimer,
  membersAtLeast,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
} from "./shared"

/**
 * Q12 — Shared Purchase / Land Pooling (COLLECTIVE).
 *
 * Multiple vendors pool loan-readiness toward shared land, equipment, or cold
 * storage. Like all collective quests it runs on an aggregate substrate built
 * from consenting members — the same engine, no branching.
 */
const landPooling: QuestDefinition = {
  key: "land-pooling",
  category: "Cooperative & Mission",
  title: "Shared Purchase / Land Pooling",
  outcome: "Pooled loan-readiness toward shared land, equipment, or cold storage",
  type: "collective",
  requiredConsentScopes: ["revenue", "operating", "reputation"],
  gatekeeper: {
    name: "the FSA / lender / seller",
    disclaimer: disclaimer("The FSA, lender, or seller"),
    links: [],
  },
  usesFields: ["documents"],
  requirements: [
    { key: "member_loan_readiness", label: "Aggregated member loan-readiness", tag: "platform", satisfied: (s) => membersAtLeast(2)(s) && lifetimeRevenueAtLeast(1)(s) },
    { key: "shared_use_plan", label: "Shared-use plan", tag: "assisted", note: "Drafted with members." },
    { key: "cost_share_agreement", label: "Cost-share agreement", tag: "vendor-supplied", note: "Members agree and upload." },
  ],
  stageGates: [
    {
      key: "forming",
      label: "Forming",
      order: 1,
      unlocks: (s) => membersAtLeast(2)(s) && lifetimeRevenueAtLeast(1)(s),
      missing: (s) => {
        const out: string[] = []
        if (!membersAtLeast(2)(s)) out.push("At least 2 consenting members")
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("Combined recorded revenue")
        return out
      },
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      unlocks: (s) => monthsActiveAtLeast(6)(s) && hasCashFlowHistory(3)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of combined operating history")
        if (!hasCashFlowHistory(3)(s)) out.push("3 months of combined cash-flow")
        return out
      },
    },
    {
      key: "financing_ready",
      label: "Financing-Ready",
      order: 3,
      unlocks: (s) => membersAtLeast(2)(s) && lifetimeRevenueAtLeast(25000)(s) && hasCashFlowHistory(6)(s),
      missing: (s) => {
        const out: string[] = []
        if (!lifetimeRevenueAtLeast(25000)(s)) out.push("$25,000 combined revenue")
        if (!hasCashFlowHistory(6)(s)) out.push("6 months of combined cash-flow")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "joint-financing-packet",
    title: "Joint Financing Packet",
    sections: [
      {
        key: "membership",
        title: "Members",
        build: (s) => ({
          available: s.collective != null,
          data: { member_count: s.collective?.member_count ?? 0 },
        }),
      },
      {
        key: "combined_financials",
        title: "Combined Financials",
        build: (s) => ({
          available: true,
          data: {
            combined_lifetime_revenue: s.revenue.lifetime_revenue,
            combined_monthly: s.revenue.monthly,
            combined_orders: s.operating.orders_fulfilled,
          },
        }),
      },
    ],
    remainingItems: () => [
      "Shared-use plan",
      "Cost-share / co-ownership agreement",
      "Purchase or lease terms for the shared asset",
    ],
  },
}

export default landPooling
