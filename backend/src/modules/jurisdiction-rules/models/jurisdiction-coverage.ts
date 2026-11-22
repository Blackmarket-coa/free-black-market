import { model } from "@medusajs/framework/utils"
import { COVERAGE_STATUSES } from "../types"

/**
 * jurisdiction_coverage: one row per (jurisdiction, program) that has been
 * opened, saying which rule keys coverage requires and where it stands.
 *
 * A state with no row is `not_covered`. `status` is the stored result of
 * `coverageStatusOf` (`../coverage.ts`), rewritten by the service in the same
 * transaction as every change to the rules it is computed from, with
 * `status_changed_at` recording when it last moved; nothing sets it directly.
 * It is a record, not what readers are told: the service's read methods work
 * the status out from the rule versions each time. `required_rule_keys` is a
 * JSON list of rule keys, set by the seed that opens the jurisdiction. On a
 * migrated database a trigger lets that list only grow, and refuses a DELETE,
 * a soft delete or a change of the row's jurisdiction or program
 * (`../db-guards.ts`), so what "covered" takes cannot be loosened.
 */
const JurisdictionCoverage = model
  .define("jurisdiction_coverage", {
    id: model.id({ prefix: "jcov" }).primaryKey(),
    /** ISO 3166-2, e.g. `US-SC`. */
    jurisdiction_code: model.text(),
    program: model.text(),
    status: model.enum([...COVERAGE_STATUSES]).default("not_covered"),
    required_rule_keys: model.json(),
    status_changed_at: model.dateTime(),
  })
  .indexes([
    {
      on: ["jurisdiction_code", "program"],
      unique: true,
      name: "IDX_jurisdiction_coverage_code_program_unique",
    },
  ])
  .checks([
    {
      name: "jurisdiction_coverage_required_rule_keys_check",
      expression: `jsonb_typeof(required_rule_keys) = 'array'`,
    },
  ])

export default JurisdictionCoverage
