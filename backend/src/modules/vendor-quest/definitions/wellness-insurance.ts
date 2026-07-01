import type { QuestDefinition } from "../types"
import {
  disclaimer,
  WELLNESS_GUARDRAIL,
  monthsActiveAtLeast,
  lifetimeRevenueAtLeast,
} from "./shared"

/**
 * Q9 — Insurance Readiness, for a WELLNESS SERVICE PRACTITIONER
 * (herbalist / bodyworker / coach). No inventory, no production ledger — this
 * quest reads ONLY universal substrate fields plus optional vendor-supplied
 * documents. It runs through the exact same engine as the FSA loan quest with
 * NO physical-goods and NO FSA branching; inventory/production are simply
 * `unavailable`. This is the primary proof the substrate isn't secretly
 * physical-goods-shaped.
 *
 * Subject to the wellness/health-claims guardrail: it documents operating
 * history and verified credentials only, and never implies clinical authority.
 */
const wellnessInsurance: QuestDefinition = {
  key: "wellness-insurance",
  category: "Certification & Trust",
  title: "Insurance Readiness (Wellness Practitioner)",
  outcome: "Operating history assembled for a liability policy quote",
  type: "individual",
  healthClaimsGuardrail: true,
  gatekeeper: {
    name: "your insurer",
    disclaimer: `${disclaimer("Your insurer")} ${WELLNESS_GUARDRAIL}`,
    links: [],
  },
  // Note: no "inventory"/"production" here — a practitioner has neither.
  usesFields: ["documents"],
  requirements: [
    {
      key: "operating_history",
      label: "Operating history",
      tag: "platform",
      satisfied: monthsActiveAtLeast(3),
      note: "Timestamped client-service history on FBM.",
    },
    {
      key: "revenue",
      label: "Revenue record",
      tag: "platform",
      satisfied: lifetimeRevenueAtLeast(1),
      note: "Income from the settlement ledger.",
    },
    {
      key: "credentials",
      label: "Verified practitioner credentials",
      tag: "vendor-supplied",
      needs: ["documents"],
      note: "Upload credentials to your vault; only verified ones are reflected.",
    },
    {
      key: "safety_compliance_docs",
      label: "Safety / compliance documentation",
      tag: "vendor-supplied",
      note: "Upload to your document vault.",
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
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of client-service history")
        if (!lifetimeRevenueAtLeast(1)(s)) out.push("At least one recorded booking/sale")
        return out
      },
    },
    {
      key: "quote_ready",
      label: "Quote-Ready",
      order: 2,
      unlocks: (s) => monthsActiveAtLeast(6)(s) && s.revenue.monthly.length >= 3,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if (s.revenue.monthly.length < 3) out.push("3 months of revenue data")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "insurer-summary",
    title: "Insurer Operating Summary",
    sections: [
      {
        key: "operating_summary",
        title: "Operating Summary",
        build: (s) => ({
          available: true,
          data: {
            operating_since: s.operating.account_created_at,
            months_active: s.operating.months_active,
            revenue_to_date: s.revenue.lifetime_revenue,
            monthly: s.revenue.monthly,
          },
        }),
      },
      {
        key: "verified_credentials",
        title: "Verified Credentials",
        build: (s) => ({
          // Only credentials a human verified — never fabricated, never implying
          // authority beyond what was confirmed.
          available: s.documents != null,
          data: (s.documents?.documents ?? []).filter((d) => d.verified),
          note: s.documents ? undefined : "No credentials uploaded.",
        }),
      },
    ],
    remainingItems: () => [
      "Completed insurance application",
      "Any policy-specific safety attestations required by the insurer",
    ],
  },
}

export default wellnessInsurance
