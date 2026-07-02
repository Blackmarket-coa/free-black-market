import type { QuestDefinition } from "../types"
import fsaFarmLoan from "./fsa-farm-loan"
import grantReadiness from "./grant-readiness"
import microlenderReadiness from "./microlender-readiness"
import crowdfundingTraction from "./crowdfunding-traction"
import wholesaleAccount from "./wholesale-account"
import marketVendor from "./market-vendor"
import readyToHire from "./ready-to-hire"
import complianceTracker from "./compliance-tracker"
import wellnessInsurance from "./wellness-insurance"
import trustTier from "./trust-tier"
import coopFormation from "./coop-formation"
import landPooling from "./land-pooling"
import commonsContribution from "./commons-contribution"

/**
 * Quest definition registry — the full catalog (Q1–Q13).
 *
 * Quest definitions are CODE CONFIG, not database rows (mirroring the
 * `listing-type` catalog pattern). Every entry here runs through the same
 * generic engine; adding a quest is a new file + registration, never an engine
 * change.
 */
export const QUEST_DEFINITIONS: QuestDefinition[] = [
  // Capital & Funding
  fsaFarmLoan, // Q1
  grantReadiness, // Q2
  microlenderReadiness, // Q3
  crowdfundingTraction, // Q4
  // Market Access & Growth
  wholesaleAccount, // Q5
  marketVendor, // Q6
  readyToHire, // Q7
  // Certification & Trust
  complianceTracker, // Q8
  wellnessInsurance, // Q9
  trustTier, // Q10
  // Cooperative & Mission (collective)
  coopFormation, // Q11
  landPooling, // Q12
  commonsContribution, // Q13
]

const BY_KEY: Record<string, QuestDefinition> = Object.fromEntries(
  QUEST_DEFINITIONS.map((d) => [d.key, d])
)

export function getQuestDefinition(key: string): QuestDefinition | undefined {
  return BY_KEY[key]
}

export function listQuestDefinitions(): QuestDefinition[] {
  return QUEST_DEFINITIONS
}
