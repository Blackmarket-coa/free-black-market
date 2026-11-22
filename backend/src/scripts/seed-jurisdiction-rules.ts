import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { JURISDICTION_RULES_MODULE } from "../modules/jurisdiction-rules"
import type JurisdictionRulesModuleService from "../modules/jurisdiction-rules/service"
import type { CoverageStatus } from "../modules/jurisdiction-rules/types"
import {
  HOME_BASED_FOOD,
  US_SC,
  US_SC_HOME_BASED_FOOD_RULES,
  US_SC_REQUIRED_RULE_KEYS,
  US_SC_SOURCES,
  type SeedSourceKey,
} from "../modules/jurisdiction-rules/seeds/us-sc-home-based-food"

/**
 * Seed the South Carolina home-based food rules as drafts.
 *
 * Run by the operator, once per environment, and safe to run again:
 *
 *   pnpm medusa exec ./src/scripts/seed-jurisdiction-rules.ts
 *
 * It records the two archived SCDA documents with their SHA-256 hashes, opens
 * US-SC / home_based_food coverage with the sixteen required rule keys, and
 * writes version 1 of each rule as a draft. Coverage then reads `draft`; it
 * reads `covered` only when a reviewer on JURISDICTION_RULE_REVIEWER_USER_IDS
 * has signed off all sixteen through the admin API. Versions the seed writes
 * record no proposer (`proposed_by_user_id` is null).
 *
 * Additive only. It never writes a review field, never adds a version to a
 * key that already has one (a draft, a reviewed version, or only withdrawn
 * ones), never edits a source that is already on file and never removes a
 * required key. After the first run the database is the source of truth and
 * the fixture is only version 1, so a second run changes nothing, and a
 * correction is made through `POST /admin/jurisdiction-rules`, not here.
 *
 * Seeding does not need FF_PLATES_V1 and does not turn anything on for
 * sellers: the flag gates what they are shown.
 */

export type SeedJurisdictionRulesSummary = {
  jurisdiction_code: string
  program: string
  sources_created: number
  sources_already_on_file: number
  /** Sources already on file whose details differ from the fixture. Left as they are. */
  sources_differing: string[]
  rules_created: number
  rules_already_on_file: number
  coverage_status: CoverageStatus
}

const COMPARED_SOURCE_FIELDS = [
  "issuer",
  "title",
  "url",
  "document_id",
  "document_date",
  "document_date_note",
  "retrieved_at",
  "archive_ref",
  "notes",
] as const

export async function seedUsScHomeBasedFood(
  service: JurisdictionRulesModuleService
): Promise<SeedJurisdictionRulesSummary> {
  const summary: SeedJurisdictionRulesSummary = {
    jurisdiction_code: US_SC,
    program: HOME_BASED_FOOD,
    sources_created: 0,
    sources_already_on_file: 0,
    sources_differing: [],
    rules_created: 0,
    rules_already_on_file: 0,
    coverage_status: "not_covered",
  }

  const sourceIdByKey = new Map<SeedSourceKey, string>()
  for (const { key, ...fields } of US_SC_SOURCES) {
    const { source, created } = await service.registerSource(fields)
    sourceIdByKey.set(key, source.id)
    if (created) {
      summary.sources_created += 1
      continue
    }
    summary.sources_already_on_file += 1
    if (COMPARED_SOURCE_FIELDS.some((field) => (source[field] ?? null) !== (fields[field] ?? null))) {
      summary.sources_differing.push(source.id)
    }
  }

  await service.openCoverage({
    jurisdiction_code: US_SC,
    program: HOME_BASED_FOOD,
    required_rule_keys: US_SC_REQUIRED_RULE_KEYS,
  })

  for (const rule of US_SC_HOME_BASED_FOOD_RULES) {
    const result = await service.createDraftVersion(
      {
        jurisdiction_code: US_SC,
        program: HOME_BASED_FOOD,
        rule_key: rule.rule_key,
        kind: rule.kind,
        value: rule.value,
        display_text: rule.display_text,
        citations: rule.citations.map((citation) => ({
          source_id: sourceIdByKey.get(citation.source)!,
          locator: citation.locator,
          quote: citation.quote ?? null,
        })),
        effective_from: rule.effective_from,
        effective_note: rule.effective_note,
      },
      { onlyIfKeyHasNoVersion: true }
    )
    if (result.created) summary.rules_created += 1
    else summary.rules_already_on_file += 1
  }

  const coverage = await service.recomputeCoverage(US_SC, HOME_BASED_FOOD)
  summary.coverage_status = coverage?.status ?? "not_covered"
  return summary
}

export default async function seedJurisdictionRules({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service = container.resolve<JurisdictionRulesModuleService>(JURISDICTION_RULES_MODULE)

  const summary = await seedUsScHomeBasedFood(service)

  logger.info(
    `[seed-jurisdiction-rules] ${summary.jurisdiction_code} ${summary.program}: ` +
      `${summary.sources_created} sources recorded (${summary.sources_already_on_file} already on file), ` +
      `${summary.rules_created} draft rules written (${summary.rules_already_on_file} keys already on file, left untouched), ` +
      `coverage reads ${summary.coverage_status}`
  )
  if (summary.sources_differing.length > 0) {
    logger.warn(
      `[seed-jurisdiction-rules] ${summary.sources_differing.length} source(s) on file differ from the fixture and were left as they are: ${summary.sources_differing.join(", ")}`
    )
  }
}
