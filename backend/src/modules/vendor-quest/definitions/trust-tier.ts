import type { QuestDefinition } from "../types"
import { disclaimer, WELLNESS_GUARDRAIL, monthsActiveAtLeast } from "./shared"

/**
 * Q10 — Platform Trust Tiers. Internal FBM unlock; NO packet (internal only).
 *
 * Universal-fields-only quest: tenure, fulfillment, dispute record, XP /
 * reputation. Demonstrates a quest with `packetTemplate: null` running through
 * the same engine (packet is simply never available). Carries the wellness
 * guardrail so a "verified" tier reflects confirmed credentials only and never
 * reads as medical/clinical authority.
 */
const trustTier: QuestDefinition = {
  key: "trust-tier",
  category: "Certification & Trust",
  title: "Platform Trust Tier",
  outcome: "Verified/established vendor status + real perks",
  type: "individual",
  healthClaimsGuardrail: true,
  gatekeeper: {
    name: "FBM (internal)",
    disclaimer: `${disclaimer("FBM's internal trust system")} ${WELLNESS_GUARDRAIL}`,
    links: [],
  },
  usesFields: [],
  requirements: [
    {
      key: "tenure",
      label: "Tenure",
      tag: "platform",
      satisfied: monthsActiveAtLeast(3),
    },
    {
      key: "fulfillment",
      label: "Fulfillment reliability",
      tag: "platform",
      satisfied: (s) =>
        s.operating.fulfillment_reliability == null ||
        s.operating.fulfillment_reliability >= 0.9,
    },
    {
      key: "dispute_record",
      label: "Clean dispute record",
      tag: "platform",
      satisfied: (s) => s.reputation.dispute_count === 0,
    },
    {
      key: "reputation",
      label: "XP / reputation",
      tag: "platform",
      satisfied: (s) => (s.reputation.trust_score ?? 0) >= 0,
    },
  ],
  stageGates: [
    {
      key: "established",
      label: "Established",
      order: 1,
      unlocks: (s) => monthsActiveAtLeast(3)(s) && s.reputation.dispute_count === 0,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of tenure")
        if (s.reputation.dispute_count !== 0) out.push("Resolve open disputes")
        return out
      },
    },
    {
      key: "verified",
      label: "Verified",
      order: 2,
      unlocks: (s) =>
        monthsActiveAtLeast(6)(s) && (s.reputation.trust_score ?? 0) >= 60,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of tenure")
        if ((s.reputation.trust_score ?? 0) < 60) out.push("Trust score of 60+")
        return out
      },
    },
  ],
  // Internal unlock — no exportable packet.
  packetTemplate: null,
}

export default trustTier
