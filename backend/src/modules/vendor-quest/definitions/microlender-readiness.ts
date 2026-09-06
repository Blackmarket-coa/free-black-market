import type { QuestDefinition } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
  hasCashFlowHistory,
  hasVerifiedDocType,
} from "./shared"

/**
 * Q3 — Microlender / CDFI / Kiva Readiness.
 *
 * The ledger proves income, tenure and cash-flow. A CDFI or credit-union
 * small-business application also asks for a business plan and use-of-funds
 * statement, entity documents, personal financials and tax returns, and
 * collateral or a co-signer — none of which FBM may generate (assemble, never
 * fabricate), all of which it can checklist and, for documents, store in the
 * vault. Those items were added 2026-09-06 (`docs/CDFI_COOP_ROADMAP.md`
 * §3.1), modelled on Q1's document handling.
 *
 * `business_plan` is `assisted` WITH a predicate: the engine treats an
 * assisted requirement that has no predicate as satisfied, so without one a
 * plan would read as done before it exists.
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
    // Generic entry points first — refer-out only; FBM never stands between
    // the vendor and the lender. Kiva stays as the crowdfunding option.
    // The CDFI Fund publishes its list of certified CDFIs as a dated download
    // linked at the top of the certification page, so the page — the stable
    // URL — is what we point at, not the file.
    links: [
      {
        label: "CDFI Fund — list of certified CDFIs",
        url: "https://www.cdfifund.gov/programs-training/certification/cdfi",
      },
      // OFN's site answers automated requests with 403, so this URL could not
      // be machine-checked; it is OFN's long-standing locator and should be
      // clicked once by a reviewer, like any refer-out link.
      {
        label: "Opportunity Finance Network — CDFI locator",
        url: "https://www.ofn.org/cdfi-locator/",
      },
      { label: "Kiva", url: "https://www.kiva.org/borrow" },
    ],
  },
  usesFields: ["documents"],
  requirements: [
    { key: "income", label: "Income record", tag: "platform", satisfied: lifetimeRevenueAtLeast(1) },
    { key: "management_history", label: "Management history", tag: "platform", satisfied: monthsActiveAtLeast(3) },
    { key: "repayment_cash_flow", label: "Repayment / cash-flow", tag: "platform", satisfied: hasCashFlowHistory(3) },
    { key: "references", label: "Character / community references", tag: "vendor-supplied", note: "Collect and upload references." },
    {
      key: "business_plan",
      label: "Business plan",
      tag: "assisted",
      needs: ["documents"],
      satisfied: hasVerifiedDocType("business_plan"),
      note:
        "FBM's packet drafts a starting point from your records; upload the finished plan to your document vault (type: business plan) for FBM review. Needs the document vault, a plan feature.",
    },
    {
      key: "use_of_funds",
      label: "Use-of-funds statement",
      tag: "vendor-supplied",
      note: "What the loan buys and how it repays. Upload to your document vault.",
    },
    {
      key: "entity_documents",
      label: "Entity documents",
      tag: "vendor-supplied",
      note: "Formation documents, EIN letter, licenses. For a cooperative, the Co-op Formation quest assembles the founding set.",
    },
    {
      key: "personal_financials_tax_returns",
      label: "Personal financial statement & tax returns",
      tag: "outside-fbm",
      note: "Prepared outside FBM; typically two to three years of returns. FBM never generates these.",
    },
    {
      key: "collateral_or_cosigner",
      label: "Collateral or co-signer",
      tag: "outside-fbm",
      note: "As the lender requires. Arranged outside FBM.",
    },
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
      {
        key: "documents",
        title: "Documents (verified state shown)",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents ? undefined : "No documents uploaded.",
        }),
      },
    ],
    remainingItems: (s) => {
      const items: string[] = []
      if (!hasVerifiedDocType("business_plan")(s)) {
        items.push("Business plan (upload to vault for FBM review)")
      }
      items.push(
        "Use-of-funds statement",
        "Entity documents (formation, EIN, licenses)",
        "Personal financial statement and tax returns",
        "Collateral schedule or co-signer, as the lender requires",
        "Character / community references",
        "Completed lender application"
      )
      return items
    },
  },
}

export default microlenderReadiness
