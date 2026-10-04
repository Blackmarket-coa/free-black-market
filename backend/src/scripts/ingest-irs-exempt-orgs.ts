import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../shared/feature-flags"
import { runIrsExemptOrgIngest } from "../jobs/irs-exempt-org-ingest"
import { IRS_SOURCES, isIrsSource, type IrsSource } from "../modules/irs-exempt-org/sources"

/**
 * Operator-run first load (and ad-hoc refresh) of the IRS exempt-org tables.
 * Same body and the same flag guard as the weekly job; this is only a way to
 * run it now rather than next Sunday.
 *
 * Run (all three sources, or a subset):
 *   pnpm medusa exec ./src/scripts/ingest-irs-exempt-orgs.ts
 *   pnpm medusa exec ./src/scripts/ingest-irs-exempt-orgs.ts pub78 revocation
 *
 * Downloads a few hundred MB and writes ~1.9M rows; storage sign-off on the
 * shared Postgres (SPOF-03) is the operator's call before the first live run
 * and is what the flag gates. Moves no money.
 */
export default async function ingestIrsExemptOrgs({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    logger.warn(
      `[ingest-irs-exempt-orgs] ${PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1} is not "true"; nothing ingested.`
    )
    return
  }

  const requested = (args ?? []).filter((a) => a && !a.startsWith("-"))
  const unknown = requested.filter((a) => !isIrsSource(a))
  if (unknown.length) {
    logger.error(
      `[ingest-irs-exempt-orgs] unknown source(s) ${unknown.join(", ")}; valid: ${IRS_SOURCES.join(", ")}`
    )
    return
  }
  const sources: readonly IrsSource[] = requested.length
    ? (requested as IrsSource[])
    : IRS_SOURCES

  logger.info(`[ingest-irs-exempt-orgs] starting: ${sources.join(", ")}`)
  const result = await runIrsExemptOrgIngest(container, { sources })
  for (const r of result?.results ?? []) {
    if (r.outcome === "failed") logger.error(`[ingest-irs-exempt-orgs] ${r.source}: failed — ${r.error}`)
    else if (r.outcome === "ingested")
      logger.info(`[ingest-irs-exempt-orgs] ${r.source}: ${r.row_count} rows, as of ${r.as_of.toISOString()}`)
    else logger.info(`[ingest-irs-exempt-orgs] ${r.source}: unchanged`)
  }
}
