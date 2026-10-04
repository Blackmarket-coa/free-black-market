import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { featureFlagState } from "../shared/feature-flags"
import { streamDownloadToFile } from "../shared/stream-download"
import { IRS_EXEMPT_ORG_MODULE } from "../modules/irs-exempt-org/module-key"
import { IRS_SOURCES, type IrsSource } from "../modules/irs-exempt-org/sources"
import type IrsExemptOrgModuleService from "../modules/irs-exempt-org/service"
import type { FetchToFile, IngestOutcome } from "../modules/irs-exempt-org/service"
import { PARTNER_DIRECTORY_MODULE } from "../modules/partner-directory"
import type PartnerDirectoryModuleService from "../modules/partner-directory/service"
import type { IrsLookupSkipReason } from "../modules/partner-directory/service"

const log = createLogger("jobs/irs-exempt-org-ingest")

/** Orgs re-verified per page of the post-ingest sweep. */
export const REVERIFY_BATCH_SIZE = 200

export type IrsIngestJobDeps = {
  fetchToFile?: FetchToFile
  now?: () => Date
  /** Defaults to all three sources, in `IRS_SOURCES` order. */
  sources?: readonly IrsSource[]
  /** Page size of the re-verification sweep; tests shrink it to prove paging. */
  reverifyBatchSize?: number
}

/** What the post-ingest sweep over `partner_org` did. */
export type ReverifyOutcome = {
  /** Rows with an EIN that were looked up. */
  checked: number
  /** Rows whose verification columns were written. */
  applied: number
  /** Rows the service declined to write, by reason. */
  skipped: Record<IrsLookupSkipReason, number>
  /** Rows that went from published to unpublished because of the new status. */
  auto_unpublished: string[]
  /** Rows whose lookup or write threw; the sweep carries on past them. */
  failed: string[]
}

export type IrsIngestJobResult = {
  results: IngestOutcome[]
  /** Null when no source was ingested this run — the sweep only follows a swap. */
  reverify: ReverifyOutcome | null
}

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
 * After a successful snapshot swap of *any* source, every `partner_org` with
 * an EIN is re-verified in pages through the same `applyIrsLookup` the admin
 * verify route uses, so a revocation (or a delisting) propagates to the
 * directory — and unpublishes a published IRS org — without an admin click
 * (L11). Never after a run in which nothing changed or everything failed:
 * the files we hold are the same files, so the answers are the same answers.
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

  const swapped = results.some((r) => r.outcome === "ingested")
  const reverify = swapped
    ? await reverifyPartnerOrgs(container, service, now, deps.reverifyBatchSize ?? REVERIFY_BATCH_SIZE)
    : null

  return { results, reverify }
}

/**
 * Re-apply the IRS lookup to every partner org that has an EIN, one page at
 * a time. A row that throws is logged and skipped so one bad row cannot stop
 * a revocation elsewhere in the table from landing.
 */
export async function reverifyPartnerOrgs(
  container: MedusaContainer,
  irs: Pick<IrsExemptOrgModuleService, "lookupEin">,
  now: () => Date,
  batchSize: number
): Promise<ReverifyOutcome> {
  const directory = container.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const take = Math.max(1, Math.floor(batchSize))
  const outcome: ReverifyOutcome = {
    checked: 0,
    applied: 0,
    skipped: { no_ein: 0, non_irs_org_type: 0, no_irs_file: 0 },
    auto_unpublished: [],
    failed: [],
  }

  for (let skip = 0; ; skip += take) {
    const batch = await directory.listOrgsWithEin({ skip, take })
    if (batch.length === 0) break

    for (const org of batch) {
      if (!org.ein) continue
      outcome.checked += 1
      try {
        const lookup = await irs.lookupEin(org.ein)
        const result = await directory.applyIrsLookup(org.key, lookup, now())
        if (result.applied) {
          outcome.applied += 1
          if (result.auto_unpublished) {
            outcome.auto_unpublished.push(org.key)
            log.warn(
              `[irs-exempt-org-ingest] ${org.key}: unpublished — IRS files now say ${result.org.verification_status}`
            )
          }
        } else {
          outcome.skipped[result.reason] += 1
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        log.error(`[irs-exempt-org-ingest] re-verify ${org.key}: ${error}`)
        outcome.failed.push(org.key)
      }
    }

    if (batch.length < take) break
  }

  log.info(
    `[irs-exempt-org-ingest] re-verified ${outcome.checked} partner orgs: ${outcome.applied} written, ` +
      `${outcome.auto_unpublished.length} unpublished, ${outcome.failed.length} failed`
  )
  return outcome
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
