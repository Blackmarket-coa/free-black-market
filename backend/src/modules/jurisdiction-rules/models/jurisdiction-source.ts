import { model } from "@medusajs/framework/utils"

/**
 * jurisdiction_source: one archived document a rule can cite.
 *
 * A source is a file in the repository (`archive_ref`, under `docs/sources/`)
 * and its SHA-256. Rows are written only by a seed that names an archived
 * file; there is no route that creates or edits one, so a citation always
 * leads to bytes that were reviewed in a pull request.
 *
 * The three dates are calendar dates as text (`2026-05-01`), not timestamps.
 * A document's printed date has no time of day and no zone, and a timestamp
 * at UTC midnight shows as the day before to every reader west of Greenwich.
 * `document_date` is null when the document prints none; `document_date_note`
 * says what is known instead. `document_id` is null when no form number is
 * printed. Readers are shown "not stated" for either.
 */
const JurisdictionSource = model
  .define("jurisdiction_source", {
    id: model.id({ prefix: "jsrc" }).primaryKey(),
    /** ISO 3166-2, e.g. `US-SC`. */
    jurisdiction_code: model.text(),
    issuer: model.text(),
    title: model.text(),
    url: model.text().nullable(),
    /** The form or publication number printed on the document, if any. */
    document_id: model.text().nullable(),
    /** The date printed on the document, `YYYY-MM-DD`, if any. */
    document_date: model.text().nullable(),
    document_date_note: model.text().nullable(),
    /** The day the archived copy was fetched, `YYYY-MM-DD`. */
    retrieved_at: model.text(),
    /** SHA-256 of the archived file, lowercase hex. */
    content_sha256: model.text(),
    /** Repository path of the archived file. */
    archive_ref: model.text(),
    notes: model.text().nullable(),
  })
  .indexes([
    {
      on: ["jurisdiction_code", "content_sha256"],
      unique: true,
      name: "IDX_jurisdiction_source_code_sha256_unique",
    },
    { on: ["jurisdiction_code"], name: "IDX_jurisdiction_source_jurisdiction_code" },
  ])
  .checks([
    { name: "jurisdiction_source_content_sha256_check", expression: `content_sha256 ~ '^[0-9a-f]{64}$'` },
    {
      name: "jurisdiction_source_document_date_check",
      expression: `document_date IS NULL OR document_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    },
    { name: "jurisdiction_source_retrieved_at_check", expression: `retrieved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` },
  ])

export default JurisdictionSource
