import type { QuestDefinition, VendorSubstrate } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
} from "./shared"

/**
 * Q1 — FSA Farm Loan Readiness (pilot quest).
 *
 * This is pure CONFIG over the generic engine. It reads mostly UNIVERSAL
 * substrate fields (revenue, cash-flow, operating history) plus a few
 * DOMAIN-optional ones (inventory, production) that degrade to "unavailable"
 * for a vendor that has none. No engine code knows this quest exists.
 *
 * Stage gates: Operating → Documented → Loan-Ready.
 * Packet: Lender Packet.
 */
const fsaFarmLoan: QuestDefinition = {
  key: "fsa-farm-loan",
  category: "Capital & Funding",
  title: "FSA Farm Loan Readiness",
  outcome: "USDA FSA Microloan / Down Payment loan application readiness",
  type: "individual",
  gatekeeper: {
    name: "your FSA loan officer",
    disclaimer: disclaimer("Your FSA loan officer"),
    links: [
      { label: "USDA FSA Farm Loans", url: "https://www.fsa.usda.gov/programs-and-services/farm-loan-programs" },
      { label: "FSA Microloan Program", url: "https://www.fsa.usda.gov/resources/programs/microloans" },
    ],
  },
  usesFields: ["inventory", "production", "documents", "channels"],
  requirements: [
    {
      key: "management_history",
      label: "Farm management history",
      tag: "platform",
      satisfied: monthsActiveAtLeast(6),
      note: "Timestamped operating record on FBM.",
    },
    {
      key: "income_verification",
      label: "Income verification",
      tag: "platform",
      satisfied: lifetimeRevenueAtLeast(1),
      note: "Income statement from the settlement ledger.",
    },
    {
      key: "cash_flow",
      label: "Cash-flow record",
      tag: "platform",
      satisfied: hasCashFlowHistory(3),
      note: "Monthly cash-flow reconstructed from real transactions.",
    },
    {
      key: "market_viability",
      label: "Market viability",
      tag: "platform",
      satisfied: (s) => s.customers.distinct_customers > 0,
      note: "Buyer/channel evidence from real orders.",
    },
    {
      key: "production_yield",
      label: "Production & yield summary",
      tag: "assisted",
      needs: ["production"],
      note: "Assembled from your production ledger when enabled.",
    },
    {
      key: "asset_valuation",
      label: "Asset / inventory valuation",
      tag: "assisted",
      needs: ["inventory"],
      note: "On-hand inventory valued at retail; add cost basis for full valuation.",
    },
    {
      key: "business_plan",
      label: "Business plan (draft)",
      tag: "assisted",
      note: "FBM drafts a starting plan from your records; you complete it.",
    },
    {
      key: "leases_contracts",
      label: "Leases & contracts",
      tag: "vendor-supplied",
      note: "Upload to your document vault.",
    },
    {
      key: "id_credit_legal_forms",
      label: "ID, credit report, legal land descriptions, FSA forms",
      tag: "outside-fbm",
      note: "Obtained and filed outside FBM. FBM never generates these.",
    },
  ],
  stageGates: [
    {
      key: "operating",
      label: "Operating",
      order: 1,
      description: "You have a real, timestamped operating record with income.",
      unlocks: (s) => monthsActiveAtLeast(3)(s) && lifetimeRevenueAtLeast(1)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(3)(s)) out.push("At least 3 months of operating history")
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("At least one recorded sale")
        return out
      },
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      description: "Enough records to assemble income + cash-flow exhibits.",
      unlocks: (s) => monthsActiveAtLeast(6)(s) && hasCashFlowHistory(3)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if (!hasCashFlowHistory(3)(s)) out.push("3 months of cash-flow data")
        return out
      },
    },
    {
      key: "loan_ready",
      label: "Loan-Ready",
      order: 3,
      description: "A full year of history and revenue floor for a lender packet.",
      unlocks: (s) =>
        monthsActiveAtLeast(12)(s) &&
        hasCashFlowHistory(6)(s) &&
        lifetimeRevenueAtLeast(1000)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(12)(s)) out.push("12 months of operating history")
        if (!hasCashFlowHistory(6)(s)) out.push("6 months of cash-flow data")
        if (!lifetimeRevenueAtLeast(1000)(s)) out.push("$1,000 lifetime revenue")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "lender-packet",
    title: "FSA Lender Packet",
    sections: [
      {
        key: "income_statement",
        title: "Income Statement",
        build: (s: VendorSubstrate) => ({
          available: true,
          data: {
            currency: s.revenue.currency,
            lifetime_revenue: s.revenue.lifetime_revenue,
            last_30d_revenue: s.revenue.last_30d_revenue,
            source: s.revenue.source,
          },
        }),
      },
      {
        key: "cash_flow_management_log",
        title: "Cash-Flow & Management Log",
        build: (s) => ({
          available: s.revenue.monthly.length > 0,
          data: {
            monthly: s.revenue.monthly,
            account_age_days: s.operating.account_age_days,
            months_active: s.operating.months_active,
            orders_fulfilled: s.operating.orders_fulfilled,
          },
        }),
      },
      {
        key: "inventory_valuation",
        title: "Inventory Valuation",
        build: (s) => ({
          available: s.inventory != null,
          data: s.inventory,
          note: s.inventory ? undefined : "No inventory module in use for this vendor.",
        }),
      },
      {
        key: "production_summary",
        title: "Production Summary",
        build: (s) => ({
          available: s.production != null,
          data: s.production,
          note: s.production ? undefined : "No production ledger in use for this vendor.",
        }),
      },
      {
        key: "channel_evidence",
        title: "Channel & Customer Evidence",
        build: (s) => ({
          available: true,
          data: {
            distinct_customers: s.customers.distinct_customers,
            repeat_customers: s.customers.repeat_customers,
            wholesale_relationships: s.customers.wholesale_relationships,
            channels: s.channels?.channels ?? [],
          },
        }),
      },
      {
        key: "business_plan_draft",
        title: "Draft Business Plan",
        build: (s) => ({
          available: true,
          note: "Starter draft assembled from your records — complete before submitting.",
          data: {
            operating_since: s.operating.account_created_at,
            revenue_to_date: s.revenue.lifetime_revenue,
            market: `${s.customers.distinct_customers} customers to date`,
          },
        }),
      },
      {
        key: "vault_documents",
        title: "Vault Documents",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents ? undefined : "No documents uploaded.",
        }),
      },
    ],
    remainingItems: (s) => {
      const items = [
        "Government-issued ID",
        "Personal credit report / authorization",
        "Legal land description(s)",
        "Completed FSA loan application forms",
      ]
      if (!s.documents?.documents.some((d) => d.doc_type === "lease")) {
        items.push("Lease or land-control documentation (upload to vault)")
      }
      if (!s.inventory) {
        items.push("Asset/equipment valuation (vendor-supplied)")
      }
      return items
    },
  },
}

export default fsaFarmLoan
