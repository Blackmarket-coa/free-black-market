import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_DIRECTORY_MODULE } from "../modules/partner-directory"
import type PartnerDirectoryModuleService from "../modules/partner-directory/service"
import type { CreatePartnerOrgInput, PartnerOrgWritable } from "../modules/partner-directory/service"

/**
 * Seed the Ground Up Liberation Project partner record (Open Decision 4,
 * docs/BMC_SURVIVAL_PROGRAMS.md §6): the first pilot partner, name only.
 *
 * Only the name is known at decision time. EIN, org type, fiscal host and
 * Stripe destination are the operator's to supply afterwards through
 * `/admin/partners/orgs/:key`; verification is the IRS ingest's to write.
 * The row therefore ships `org_type: null`, `ein: null`, unverified and
 * **unpublished**, with no jurisdiction (`states: []`) and no contact.
 *
 * Idempotent, and deliberately conservative on re-run: a second run restores
 * the name and fills `tagline` only if it is still null. It never touches
 * `published`, any `verification_*` column, `org_type`, `ein`, the fiscal
 * host or `stripe_connect_account_id` — those are the operator's edits.
 *
 * Operator-run ONLY:
 *   pnpm medusa exec ./src/scripts/seed-partner-gulp.ts
 *
 * NOT imported from `src/scripts/seed.ts`: `scripts/conditional-seed.js`
 * runs that on deploy, and a pilot partner is not deploy-time data. The unit
 * spec greps for this.
 */
export const GULP_PARTNER_KEY = "ground_up_liberation_project"
export const GULP_PARTNER_NAME = "Ground Up Liberation Project"

/** Exactly what Decision 4 permits the seed to assert. */
export const GULP_SEED_RECORD: CreatePartnerOrgInput = {
  key: GULP_PARTNER_KEY,
  name: GULP_PARTNER_NAME,
  org_type: null,
  ein: null,
  relationship: "sponsored_collective",
  fiscal_host_key: null,
  stripe_connect_account_id: null,
  published: false,
  states: [],
  serves: [],
  url: null,
  tagline: null,
}

export const GULP_UNVERIFIED_NOTICE =
  "unverified — do not publish until IRS verification (S8) or counsel sign-off for a non-IRS org type"

export default async function seedPartnerGulp({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const directory = container.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)

  logger.info(`[seed-partner-gulp] starting (key=${GULP_PARTNER_KEY})`)

  const existing = await directory.getOrgByKey(GULP_PARTNER_KEY)

  if (!existing) {
    const created = await directory.createOrg({ ...GULP_SEED_RECORD })
    logger.info(
      `[seed-partner-gulp] created ${created.key} ("${created.name}") published=${created.published} ` +
        `verification_status=${created.verification_status} relationship=${created.relationship}`
    )
    logger.info(`[seed-partner-gulp] ${GULP_PARTNER_NAME}: ${GULP_UNVERIFIED_NOTICE}`)
    return
  }

  const patch: PartnerOrgWritable = {}
  if (existing.name !== GULP_PARTNER_NAME) patch.name = GULP_PARTNER_NAME
  if (existing.tagline == null && GULP_SEED_RECORD.tagline != null) patch.tagline = GULP_SEED_RECORD.tagline

  if (Object.keys(patch).length > 0) {
    await directory.updateOrg(GULP_PARTNER_KEY, patch)
    logger.info(`[seed-partner-gulp] updated ${Object.keys(patch).join(", ")} on ${GULP_PARTNER_KEY}`)
  } else {
    logger.info(`[seed-partner-gulp] ${GULP_PARTNER_KEY} already present; nothing to change`)
  }

  logger.info(
    `[seed-partner-gulp] operator-set fields left as found: published=${existing.published} ` +
      `verification_status=${existing.verification_status} org_type=${existing.org_type ?? "null"} ` +
      `stripe_connect_account_id=${existing.stripe_connect_account_id ? "set" : "null"}`
  )
  if (existing.verification_status === "unverified") {
    logger.info(`[seed-partner-gulp] ${GULP_PARTNER_NAME}: ${GULP_UNVERIFIED_NOTICE}`)
  }
}
