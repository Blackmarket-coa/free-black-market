import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { featureFlagState } from "../shared/feature-flags"
import { streamDownloadToFile } from "../shared/stream-download"
import { IRS_EXEMPT_ORG_MODULE } from "../modules/irs-exempt-org/module-key"
import { IRS_SOURCES, type IrsSource } from "../modules/irs-exempt-org/sources"
import type IrsExemptOrgModuleService from "../modules/irs-exempt-org/service"
import type { FetchToFile, IngestOutcome } from "../modules/irs-exempt-org/service"

const log = createLogger("jobs/irs-exempt-org-ingest")

export type IrsIngestJobDeps = {
  fetchToFile?: FetchToFile
  now?: () => Date
  /** Defaults to all three sources, in `IRS_SOURCES` order. */
  sources?: readonly IrsSource[]
}

export type IrsIngestJobResult = { results: IngestOutcome[] }

const defaultFetchToFile: FetchToFile = (url, opts) => streamDownloadToFile(url, opts)

/**
 * Weekly: refresh the IRS exempt-org tables from the three public bulk files
 * (Pub 78 Data, the Automatic Revocation of Exemption List, the EO Business
 * Master File), skipping any file that has not changed.
 *
 * **Moves no money.** Reads public files about third parties; writes nothing
 * but org-level facts and per-source as-of dates.
 *
 * Why weekly check-and-skip rather than a monthly cron: the three files are
 * published on different days (observed 2026-09-07, -10 and -30), so one
 * monthly run after a fixed date is always stale for at least one of them;
 * and a >24.8-day interval overflows the in-memory workflow engine's timer
 * when `REDIS_URL` is unset (see `patronage-refund.ts`). A conditional GET on
 * an unchanged file is one round trip and no download, so the weekly check
 * costs nearly nothing and the data refreshes within a week of the IRS
 * posting it — which is the actual resolution of the upstream data.
 *
 * Sources degrade independently: a parse failure in one leaves the other two
 * refreshed and that source's previous snapshot still visible.
 *
 * Exported as `runIrsExemptOrgIngest` so tests drive it with a fixture fetch
 * and no network (the `channel-order-sync.ts` split).
 */
export async function runIrsExemptOrgIngest(
  container: MedusaContainer,
  deps: IrsIngestJobDeps = {}
): Promise<IrsIngestJobResult | null> {
  // Flag first, before anything touches the container: with the flag off the
  // module may well not be registered, and resolving it would throw.
  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return null

  const service = container.resolve<IrsExemptOrgModuleService>(IRS_EXEMPT_ORG_MODULE)
  const fetchToFile = deps.fetchToFile ?? defaultFetchToFile
  const now = deps.now ?? (() => new Date())
  const results: IngestOutcome[] = []

  for (const source of deps.sources ?? IRS_SOURCES) {
    try {
      const outcome = await service.ingestSource(source, { fetchToFile, now })
      results.push(outcome)
      if (outcome.outcome === "failed") {
        log.error(`[irs-exempt-org-ingest] ${source}: failed — ${outcome.error}`)
      } else if (outcome.outcome === "ingested") {
        log.info(
          `[irs-exempt-org-ingest] ${source}: ${outcome.row_count} rows, file dated ${outcome.as_of.toISOString()}`
        )
      } else {
        log.info(`[irs-exempt-org-ingest] ${source}: unchanged since ${outcome.as_of?.toISOString() ?? "never"}`)
      }
    } catch (err) {
      // Only a missing database connection reaches here; data errors are
      // returned as a failed outcome by the service. Keep going so the other
      // sources still get their turn.
      const error = err instanceof Error ? err.message : String(err)
      log.error(`[irs-exempt-org-ingest] ${source}: ${error}`)
      results.push({ source, outcome: "failed", error })
    }
  }

  return { results }
}

export default async function irsExemptOrgIngest(
  container: MedusaContainer
): Promise<IrsIngestJobResult | null> {
  if (!featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) return null
  return runIrsExemptOrgIngest(container)
}

export const config = {
  name: "irs-exempt-org-ingest",
  // Sundays 04:00 UTC: off-peak, and after the IRS's usual Tuesday/Monday
  // postings have had the week to settle. Weekly on purpose — see the header.
  schedule: "0 4 * * 0",
}
