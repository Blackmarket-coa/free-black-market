import type { QuestDefinition } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
} from "./shared"

/**
 * Q3 — Microlender / CDFI / Kiva Readiness.
 */
const microlenderReadiness: QuestDefinition = {
  key: "microlender-readiness",
  category: "Capital & Funding",
  title: "Microlender / CDFI Readiness",
  outcome: "Alternative-lender application (CDFI / microlender / crowdfunder)",
  type: "individual",
  gatekeeper: {
    name: "the CDFI or microlender",
    disclaimer: disclaimer("The CDFI or microlender"),
    links: [{ label: "Kiva", url: "https://www.kiva.org/borrow" }],
  },
  usesFields: ["documents"],
  requirements: [
    { key: "income", label: "Income record", tag: "platform", satisfied: lifetimeRevenueAtLeast(1) },
    { key: "management_history", label: "Management history", tag: "platform", satisfied: monthsActiveAtLeast(3) },
    { key: "repayment_cash_flow", label: "Repayment / cash-flow", tag: "platform", satisfied: hasCashFlowHistory(3) },
    { key: "references", label: "Character / community references", tag: "vendor-supplied", note: "Collect and upload references." },
  ],
  stageGates: [
    {
      key: "operating",
      label: "Operating",
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
      unlocks: (s) => hasCashFlowHistory(3)(s),
      missing: (s) => (hasCashFlowHistory(3)(s) ? [] : ["3 months of cash-flow data"]),
    },
    {
      key: "lender_ready",
      label: "Lender-Ready",
      order: 3,
      unlocks: (s) => monthsActiveAtLeast(6)(s) && lifetimeRevenueAtLeast(500)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if (!lifetimeRevenueAtLeast(500)(s)) out.push("$500 revenue")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "microlender-summary",
    title: "Lender Summary",
    sections: [
      {
        key: "summary",
        title: "Borrower Summary",
        build: (s) => ({
          available: true,
          data: {
            operating_since: s.operating.account_created_at,
            lifetime_revenue: s.revenue.lifetime_revenue,
            avg_daily_revenue: s.revenue.avg_daily_revenue,
          },
        }),
      },
      {
        key: "traction",
        title: "Traction",
        build: (s) => ({
          available: true,
          data: {
            monthly: s.revenue.monthly,
            distinct_customers: s.customers.distinct_customers,
            repeat_customers: s.customers.repeat_customers,
          },
        }),
      },
    ],
    remainingItems: () => ["Character / community references", "Completed lender application"],
  },
}

export default microlenderReadiness
