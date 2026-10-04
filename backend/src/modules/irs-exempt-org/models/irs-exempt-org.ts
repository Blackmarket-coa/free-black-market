import { model } from "@medusajs/framework/utils"

/**
 * One row per EIN from the IRS Exempt Organizations Business Master File
 * extract (eo1–eo4, eo_xx). Replaced wholesale on each ingest by the
 * staging-table swap in `service.ts`; never edited by hand or by an admin.
 *
 * Column set is deliberately the org-level subset of the 28 BMF columns.
 * `ICO` ("in care of" — a person's name) and `STREET` are not ingested, and
 * there is no column for them to land in: PII minimisation
 * (docs/BMC_SURVIVAL_PROGRAMS.md §5). The customer-data drift guard keys on
 * `customer_id` and will not notice this table, so the omission is a design
 * decision, recorded in docs/AUDIT_DEBT.md, not something enforced for us.
 *
 * `ein` is TEXT: the file's EINs are zero-padded nine-character strings and
 * an integer column would silently corrupt every EIN beginning with 0.
 */
const IrsExemptOrg = model
  .define("irs_exempt_org", {
    id: model.id().primaryKey(),
    /** Nine zero-padded digits. Unique among live rows. */
    ein: model.text(),
    name: model.text(),
    city: model.text().nullable(),
    state: model.text().nullable(),
    /** First five characters of the BMF ZIP ("96799-1715" → "96799"). */
    zip5: model.text().nullable(),
    /** 501(c) subsection code, two characters ("03", "04"). */
    subsection: model.text().nullable(),
    classification: model.text().nullable(),
    /** Ruling year-month, "YYYYMM". */
    ruling: model.text().nullable(),
    /** BMF deductibility code ("1" deductible, "2" not, "4" by treaty). */
    deductibility: model.text().nullable(),
    foundation: model.text().nullable(),
    /** BMF status code ("01" unconditional exemption …). */
    status: model.text().nullable(),
    ntee_cd: model.text().nullable(),
    sort_name: model.text().nullable(),
  })
  .indexes([
    {
      on: ["ein"],
      name: "UQ_irs_exempt_org_ein",
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default IrsExemptOrg
