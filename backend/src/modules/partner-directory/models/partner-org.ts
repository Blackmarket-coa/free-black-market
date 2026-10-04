import { model } from "@medusajs/framework/utils"
import {
  PARTNER_ORG_RELATIONSHIP,
  PARTNER_ORG_TYPES,
  PARTNER_ORG_VERIFICATION,
} from "../org-types"

/**
 * partner_org — a persisted pilot-partner record (docs/BMC_SURVIVAL_PROGRAMS.md
 * Phase 1 item 1; docs/reuse/04-partner-platforms.md §7).
 *
 * Distinct from the static refer-out catalog in `../catalog.ts`, whose three
 * rules (link out, list only what works, no compensation) and shape test
 * forbid exactly what a pilot partner carries: an EIN, a Stripe Connect
 * destination and a fiscal-host pair. Those live here, default-unpublished.
 *
 * What is deliberately absent:
 *
 * - **No balance, accrued or pending-amount column.** Posture A rule 3
 *   (docs/POSTURE_A_COMPLIANCE.md): FBM holds nothing for anyone.
 *   `stripe_connect_account_id` is a destination for direct charges on the
 *   org's own account (L24), never a place money sits on FBM's books.
 * - **No contact name / email / phone.** §5 PII minimisation; the catalog
 *   shape test already forbids `contact_email` on entries.
 * - **No determination-letter or other uploads.**
 *
 * Verification columns are written only by the IRS ingest. `verified_as_of`
 * is the IRS file's date; `verification_checked_at` is when the ingest ran.
 * They differ on purpose: L11 requires the file's as-of date be shown.
 *
 * `states` and `serves` default empty. No jurisdiction is hard-coded.
 */
/**
 * The DML types every JSON column as `Record<string, unknown>`; an array is
 * valid JSONB and is what these two columns hold. The service converts at its
 * persistence boundary (`toPersisted`) so callers see `string[]`.
 */
const EMPTY_JSON_LIST = [] as unknown as Record<string, unknown>

const PartnerOrg = model
  .define("partner_org", {
    id: model.id().primaryKey(),
    /** Stable business key, e.g. `ground_up_liberation_project`. */
    key: model.text().unique(),
    name: model.text().searchable(),
    org_type: model.enum([...PARTNER_ORG_TYPES]).nullable(),
    /** Nine digits, zero-padded; TEXT because a leading zero is data. */
    ein: model.text().nullable(),

    verification_status: model.enum([...PARTNER_ORG_VERIFICATION]).default("unverified"),
    /** Which file family answered, e.g. `irs_bulk_file`. */
    verification_source: model.text().nullable(),
    /** The IRS file's own date — what the UI shows (L11). */
    verified_as_of: model.dateTime().nullable(),
    /** When the ingest last looked. Server-side only. */
    verification_checked_at: model.dateTime().nullable(),

    relationship: model.enum([...PARTNER_ORG_RELATIONSHIP]).default("standalone"),
    /** Self-reference by `key` to the org acting as fiscal host. */
    fiscal_host_key: model.text().nullable(),
    /** Destination for direct charges only. Nullable; no balance beside it. */
    stripe_connect_account_id: model.text().nullable(),

    published: model.boolean().default(false),
    url: model.text().nullable(),
    tagline: model.text().nullable(),
    states: model.json().default(EMPTY_JSON_LIST),
    serves: model.json().default(EMPTY_JSON_LIST),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["published"], name: "IDX_partner_org_published" },
    { on: ["fiscal_host_key"], name: "IDX_partner_org_fiscal_host" },
  ])

export default PartnerOrg
