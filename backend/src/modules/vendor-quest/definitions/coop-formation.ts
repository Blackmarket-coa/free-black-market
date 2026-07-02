import type { QuestDefinition } from "../types"
import { disclaimer, lifetimeRevenueAtLeast, monthsActiveAtLeast } from "./shared"

/**
 * Q11 — Co-op Formation Readiness (COLLECTIVE quest).
 *
 * Several vendors assemble combined records to form a cooperative. It runs
 * through the SAME generic engine: the collective service aggregates consenting
 * members' substrates into one synthetic substrate (via `aggregateSubstrates`)
 * and this definition evaluates it exactly like an individual quest. The only
 * collective-aware bit is reading `s.collective?.member_count` — a
 * domain-optional field that is `null` for individuals, so no engine branching.
 *
 * `requiredConsentScopes` lists what each member must consent to before their
 * record is aggregated (never aggregate un-consented data).
 */
const coopFormation: QuestDefinition = {
  key: "coop-formation",
  category: "Cooperative & Mission",
  title: "Co-op Formation Readiness",
  outcome: "Combined member records assembled to form a cooperative",
  type: "collective",
  requiredConsentScopes: ["revenue", "operating", "customers", "reputation", "documents"],
  gatekeeper: {
    name: "your co-op's incorporation process and members",
    disclaimer: disclaimer("Your co-op's incorporation body and members"),
    links: [
      { label: "USDA Co-op Information", url: "https://www.rd.usda.gov/programs-services/cooperative-services" },
    ],
  },
  usesFields: ["documents"],
  requirements: [
    {
      key: "member_operating_records",
      label: "Each member's operating record",
      tag: "platform",
      satisfied: (s) => (s.collective?.member_count ?? 0) >= 2,
      note: "Combined from consenting members' FBM history.",
    },
    {
      key: "combined_financials",
      label: "Combined financials",
      tag: "assisted",
      satisfied: (s) => s.revenue.lifetime_revenue > 0,
      note: "Aggregated income + cash-flow across members.",
    },
    {
      key: "governance_bylaws",
      label: "Governance / bylaws",
      tag: "vendor-supplied",
      needs: ["documents"],
      note: "Draft and upload to the shared vault.",
    },
    {
      key: "incorporation",
      label: "Incorporation filing",
      tag: "outside-fbm",
      note: "Filed with your state; FBM never generates legal filings.",
    },
  ],
  stageGates: [
    {
      key: "forming",
      label: "Forming",
      order: 1,
      description: "At least two consenting members with real history.",
      unlocks: (s) => (s.collective?.member_count ?? 0) >= 2 && lifetimeRevenueAtLeast(1)(s),
      missing: (s) => {
        const out: string[] = []
        if ((s.collective?.member_count ?? 0) < 2) out.push("At least 2 consenting members")
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("Combined recorded revenue")
        return out
      },
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      description: "Enough combined tenure and revenue to assemble exhibits.",
      unlocks: (s) =>
        (s.collective?.member_count ?? 0) >= 2 &&
        monthsActiveAtLeast(6)(s) &&
        lifetimeRevenueAtLeast(5000)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of combined operating history")
        if (!lifetimeRevenueAtLeast(5000)(s)) out.push("$5,000 combined revenue")
        return out
      },
    },
    {
      key: "formation_ready",
      label: "Formation-Ready",
      order: 3,
      description: "A cooperative-scale combined record.",
      unlocks: (s) =>
        (s.collective?.member_count ?? 0) >= 3 &&
        monthsActiveAtLeast(12)(s) &&
        lifetimeRevenueAtLeast(20000)(s),
      missing: (s) => {
        const out: string[] = []
        if ((s.collective?.member_count ?? 0) < 3) out.push("At least 3 members")
        if (!monthsActiveAtLeast(12)(s)) out.push("12 months of combined history")
        if (!lifetimeRevenueAtLeast(20000)(s)) out.push("$20,000 combined revenue")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "coop-formation-bundle",
    title: "Co-op Formation Bundle",
    sections: [
      {
        key: "membership",
        title: "Membership",
        build: (s) => ({
          available: s.collective != null,
          data: {
            member_count: s.collective?.member_count ?? 0,
            member_ids: s.collective?.member_ids ?? [],
          },
        }),
      },
      {
        key: "combined_financials",
        title: "Combined Financials",
        build: (s) => ({
          available: true,
          data: {
            currency: s.revenue.currency,
            combined_lifetime_revenue: s.revenue.lifetime_revenue,
            combined_monthly: s.revenue.monthly,
            combined_customers: s.customers.distinct_customers,
          },
        }),
      },
      {
        key: "combined_operating",
        title: "Combined Operating History",
        build: (s) => ({
          available: true,
          data: {
            combined_listings: s.operating.listing_count,
            combined_orders: s.operating.orders_fulfilled,
            oldest_member_since: s.operating.account_created_at,
          },
        }),
      },
      {
        key: "shared_documents",
        title: "Shared Vault Documents",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents ? undefined : "No shared documents uploaded.",
        }),
      },
    ],
    remainingItems: () => [
      "Draft cooperative bylaws / operating agreement",
      "Articles of incorporation (filed with your state)",
      "Member equity / capitalization agreement",
    ],
  },
}

export default coopFormation
