import type { QuestDefinition } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
  ordersFulfilledAtLeast,
} from "./shared"

/**
 * Q7 — Ready-to-Hire Milestone (evidence a vendor can support a first employee).
 */
const readyToHire: QuestDefinition = {
  key: "ready-to-hire",
  category: "Market Access & Growth",
  title: "Ready-to-Hire Milestone",
  outcome: "Signal + evidence you can support a first employee",
  type: "individual",
  gatekeeper: {
    name: "you (and your lender / payroll setup)",
    disclaimer: disclaimer("You, your lender, and your payroll provider"),
    links: [],
  },
  usesFields: [],
  requirements: [
    { key: "revenue_threshold", label: "Revenue threshold", tag: "platform", satisfied: lifetimeRevenueAtLeast(30000) },
    { key: "order_trend", label: "Order-volume trend", tag: "platform", satisfied: ordersFulfilledAtLeast(100) },
    { key: "cash_flow_stability", label: "Cash-flow stability", tag: "platform", satisfied: hasCashFlowHistory(6) },
    { key: "labor_cost_model", label: "Labor-cost model", tag: "assisted", note: "Drafted from cash-flow; you set wage assumptions." },
  ],
  stageGates: [
    {
      key: "growing",
      label: "Growing",
      order: 1,
      unlocks: (s) => monthsActiveAtLeast(6)(s) && ordersFulfilledAtLeast(50)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if (!ordersFulfilledAtLeast(50)(s)) out.push("50 fulfilled orders")
        return out
      },
    },
    {
      key: "stable",
      label: "Stable",
      order: 2,
      unlocks: (s) => hasCashFlowHistory(6)(s) && lifetimeRevenueAtLeast(15000)(s),
      missing: (s) => {
        const out: string[] = []
        if (!hasCashFlowHistory(6)(s)) out.push("6 months of cash-flow data")
        if (!lifetimeRevenueAtLeast(15000)(s)) out.push("$15,000 revenue")
        return out
      },
    },
    {
      key: "hire_ready",
      label: "Hire-Ready",
      order: 3,
      unlocks: (s) => lifetimeRevenueAtLeast(30000)(s) && ordersFulfilledAtLeast(100)(s),
      missing: (s) => {
        const out: string[] = []
        if (!lifetimeRevenueAtLeast(30000)(s)) out.push("$30,000 revenue")
        if (!ordersFulfilledAtLeast(100)(s)) out.push("100 fulfilled orders")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "hiring-readiness-summary",
    title: "Hiring-Readiness Cash-Flow Summary",
    sections: [
      {
        key: "cash_flow",
        title: "Cash-Flow Summary",
        build: (s) => ({
          available: true,
          data: {
            lifetime_revenue: s.revenue.lifetime_revenue,
            avg_daily_revenue: s.revenue.avg_daily_revenue,
            monthly: s.revenue.monthly,
            orders_fulfilled: s.operating.orders_fulfilled,
          },
        }),
      },
    ],
    remainingItems: () => ["Wage & hours assumptions", "Payroll / tax registration", "Workers' comp (if required)"],
  },
}

export default readyToHire
