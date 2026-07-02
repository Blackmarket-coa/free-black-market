import type { QuestDefinition } from "../types"
import fsaFarmLoan from "./fsa-farm-loan"
import wellnessInsurance from "./wellness-insurance"
import trustTier from "./trust-tier"
import coopFormation from "./coop-formation"

/**
 * Quest definition registry.
 *
 * Quest definitions are CODE CONFIG, not database rows — mirroring the
 * `listing-type` catalog pattern. Adding a new quest from the catalog (Q2–Q8,
 * Q11–Q13) means adding a file here + any missing substrate mapping, never
 * touching the engine.
 */
export const QUEST_DEFINITIONS: QuestDefinition[] = [
  fsaFarmLoan,
  wellnessInsurance,
  trustTier,
  coopFormation,
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
