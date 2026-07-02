import type { QuestDefinition } from "../types"
import { disclaimer, monthsActiveAtLeast } from "./shared"

/**
 * Q13 — Commons Contribution Goals. Internal FBM recognition + XP; NO packet.
 *
 * Tied to surplus routing, time-banking, mutual aid, and tithing to the Commons.
 * Progress reads universal signals (tenure, clean dispute record, reputation) —
 * contribution volume flows through the hawala ledger and XP rather than an
 * external packet.
 */
const commonsContribution: QuestDefinition = {
  key: "commons-contribution",
  category: "Cooperative & Mission",
  title: "Commons Contribution Goals",
  outcome: "Recognition + XP for routing surplus to the Commons",
  type: "individual",
  gatekeeper: {
    name: "the FBM Commons layer (internal)",
    disclaimer: disclaimer("The FBM Commons layer"),
    links: [],
  },
  usesFields: [],
  requirements: [
    { key: "contribution_records", label: "Surplus / contribution records", tag: "platform", satisfied: monthsActiveAtLeast(1) },
    { key: "ledger_rails", label: "Hawala-ledger rails", tag: "platform", satisfied: () => true, note: "Contributions settle through the existing ledger." },
  ],
  stageGates: [
    {
      key: "contributing",
      label: "Contributing",
      order: 1,
      unlocks: (s) => monthsActiveAtLeast(1)(s) && s.reputation.dispute_count === 0,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(1)(s)) out.push("1 month of activity")
        if (s.reputation.dispute_count !== 0) out.push("Resolve open disputes")
        return out
      },
    },
    {
      key: "established",
      label: "Established",
      order: 2,
      unlocks: (s) => monthsActiveAtLeast(6)(s) && s.reputation.total_xp > 0,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of activity")
        if (s.reputation.total_xp <= 0) out.push("Earn some XP through participation")
        return out
      },
    },
  ],
  // Internal recognition + XP only — no exportable packet.
  packetTemplate: null,
}

export default commonsContribution
