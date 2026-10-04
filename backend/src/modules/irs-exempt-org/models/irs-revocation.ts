import { model } from "@medusajs/framework/utils"

/**
 * One row per revocation event from the Automatic Revocation of Exemption
 * List. An EIN can appear more than once (revoked, reinstated, revoked again),
 * so this is keyed on (ein, posting_date, revocation_date), not on ein alone.
 *
 * A row with a `reinstatement_date` is historical: the IRS has since
 * reinstated the org, and `lookup.ts` does not treat it as a current
 * revocation. The street address and ZIP in the file are parsed past and
 * never stored.
 */
const IrsRevocation = model
  .define("irs_revocation", {
    id: model.id().primaryKey(),
    ein: model.text(),
    legal_name: model.text(),
    dba_name: model.text().nullable(),
    city: model.text().nullable(),
    state: model.text().nullable(),
    country: model.text().nullable(),
    /** 501(c) subsection code ("03"), or "00" when the file does not say. */
    exemption_type: model.text().nullable(),
    /** Effective date of revocation (the third missed filing deadline). */
    revocation_date: model.dateTime(),
    /** Date the IRS published the org to the list. */
    posting_date: model.dateTime(),
    /** Effective date of reinstatement, when the org has been reinstated. */
    reinstatement_date: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["ein"],
      name: "IDX_irs_revocation_ein",
      where: "deleted_at IS NULL",
    },
  ])

export default IrsRevocation
