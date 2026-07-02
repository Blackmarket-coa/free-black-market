import type { QuestDefinition } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
} from "./shared"

/**
 * Q2 — Grant Readiness (USDA Value-Added Producer Grant, SARE, state grants).
 */
const grantReadiness: QuestDefinition = {
  key: "grant-readiness",
  category: "Capital & Funding",
  title: "Grant Readiness",
  outcome: "Grant application packet (narrative + financial exhibits)",
  type: "individual",
  gatekeeper: {
    name: "the granting agency",
    disclaimer: disclaimer("The granting agency"),
    links: [
      { label: "USDA Value-Added Producer Grant", url: "https://www.rd.usda.gov/programs-services/business-programs/value-added-producer-grants" },
    ],
  },
  usesFields: ["production", "inventory", "documents"],
  requirements: [
    { key: "revenue_history", label: "Project & revenue history", tag: "platform", satisfied: lifetimeRevenueAtLeast(1) },
    { key: "value_added_evidence", label: "Value-added product evidence", tag: "platform", needs: ["production"], note: "From your production ledger when enabled." },
    { key: "market_plan", label: "Market plan", tag: "assisted", note: "Drafted from your channel/customer record." },
    { key: "matching_funds", label: "Matching-funds proof", tag: "assisted", note: "Assembled from revenue; you confirm the match." },
    { key: "narrative", label: "Grant narrative", tag: "assisted", note: "Auto-drafted from your records; you complete it." },
    { key: "eligibility_legal", label: "Eligibility & legal documents", tag: "outside-fbm", note: "Obtained outside FBM." },
  ],
  stageGates: [
    {
      key: "eligible",
      label: "Eligible",
      order: 1,
      unlocks: (s) => monthsActiveAtLeast(3)(s) && lifetimeRevenueAtLeast(1)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of operating history")
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("At least one recorded sale")
        return out
      },
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      unlocks: (s) => hasCashFlowHistory(3)(s) && lifetimeRevenueAtLeast(2000)(s),
      missing: (s) => {
        const out: string[] = []
        if (!hasCashFlowHistory(3)(s)) out.push("3 months of cash-flow data")
        if (!lifetimeRevenueAtLeast(2000)(s)) out.push("$2,000 revenue")
        return out
      },
    },
    {
      key: "grant_ready",
      label: "Grant-Ready",
      order: 3,
      unlocks: (s) => monthsActiveAtLeast(12)(s) && lifetimeRevenueAtLeast(10000)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(12)(s)) out.push("12 months of operating history")
        if (!lifetimeRevenueAtLeast(10000)(s)) out.push("$10,000 revenue")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "grant-packet",
    title: "Grant Application Packet",
    sections: [
      {
        key: "narrative_draft",
        title: "Grant Narrative (draft)",
        build: (s) => ({
          available: true,
          note: "Starter narrative — complete and tailor to the program.",
          data: { operating_since: s.operating.account_created_at, revenue_to_date: s.revenue.lifetime_revenue },
        }),
      },
      {
        key: "financial_exhibits",
        title: "Financial Exhibits",
        build: (s) => ({
          available: true,
          data: { currency: s.revenue.currency, lifetime_revenue: s.revenue.lifetime_revenue, monthly: s.revenue.monthly },
        }),
      },
      {
        key: "value_added_evidence",
        title: "Value-Added Evidence",
        build: (s) => ({
          available: s.production != null,
          data: s.production,
          note: s.production ? undefined : "No production ledger in use for this vendor.",
        }),
      },
    ],
    remainingItems: () => [
      "Program-specific eligibility documentation",
      "Matching-funds confirmation",
      "Completed grant application forms",
    ],
  },
}

export default grantReadiness
