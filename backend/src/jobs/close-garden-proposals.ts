import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../shared/logger"
import { finalizeProposalWorkflow } from "../workflows/governance/finalize-proposal"

const log = createLogger("jobs/close-garden-proposals")

/**
 * Close garden proposals whose voting period has ended.
 *
 * `workflows/governance/finalize-proposal.ts` holds the only real threshold
 * arithmetic in the ecosystem — quorum on turnout, approval excluding
 * abstains, and the pass/reject/tie/expired decision — and until this job it
 * had **no callers at all**. Routes wrote votes straight through the service,
 * so a garden proposal stayed `active` for ever: the voting period ended and
 * nothing noticed. A vote that never closes is not a vote.
 * docs/TRANSMUTATION_STRATEGY.md §5.4.
 *
 * **Proposals with no recorded electorate are skipped, not closed.** Quorum is
 * measured as `unique_voters / eligible_voters`, and `eligible_voters` is
 * nullable with nothing in the tree writing it. Closing on a guessed
 * denominator would mark every proposal "quorum met" on a number nobody set,
 * which is a worse failure than staying open — the proposal is still visibly
 * unresolved rather than falsely resolved. The workflow refuses these with
 * `UnknownElectorateError`; the job filters them out first so the refusal is a
 * counted, logged skip rather than a batch of errors, and warns once per sweep
 * with the count so the gap stays visible instead of going quiet.
 *
 * Hourly. `voting_end` is a datetime a garden set for itself, not a deadline
 * measured in minutes, and the result is the same whether it is computed at
 * the top of the hour or on the minute. Offset to :20 to stay out of the
 * crowded :00 slot.
 */

export type ProposalToClose = {
  id: string
  eligible_voters?: number | null
}

export type CloseResult = {
  proposal_id: string
  outcome: "closed" | "skipped_unknown_electorate" | "failed"
  error?: string
}

/**
 * The sweep itself, container-free so it can be unit-tested with fakes.
 *
 * `finalize` is injected rather than imported so a test does not need a
 * Medusa container to exercise the skip rule and the per-proposal isolation.
 */
export async function closeOverdueProposals(
  proposals: readonly ProposalToClose[],
  finalize: (proposalId: string) => Promise<void>
): Promise<CloseResult[]> {
  const results: CloseResult[] = []

  for (const proposal of proposals) {
    const electorate = proposal.eligible_voters
    if (!electorate || electorate <= 0) {
      results.push({
        proposal_id: proposal.id,
        outcome: "skipped_unknown_electorate",
      })
      continue
    }

    try {
      await finalize(proposal.id)
      results.push({ proposal_id: proposal.id, outcome: "closed" })
    } catch (error: any) {
      // One garden's bad proposal must not stop another garden's from closing.
      results.push({
        proposal_id: proposal.id,
        outcome: "failed",
        error: error?.message ?? String(error),
      })
    }
  }

  return results
}

export default async function closeGardenProposalsJob(
  container: MedusaContainer
): Promise<void> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: overdue } = await query.graph({
      entity: "garden_proposal",
      fields: ["id", "eligible_voters"],
      filters: {
        status: "active",
        voting_end: { $lt: new Date() },
      },
    })

    if (!overdue.length) {
      return
    }

    const results = await closeOverdueProposals(
      overdue as ProposalToClose[],
      async (proposalId) => {
        await finalizeProposalWorkflow(container).run({
          input: { proposal_id: proposalId },
        })
      }
    )

    const closed = results.filter((r) => r.outcome === "closed").length
    const skipped = results.filter(
      (r) => r.outcome === "skipped_unknown_electorate"
    )
    const failed = results.filter((r) => r.outcome === "failed")

    log.info(
      `[close-garden-proposals] ${results.length} proposal(s) past voting_end: ` +
        `closed=${closed}, skipped=${skipped.length}, failed=${failed.length}`
    )

    if (skipped.length) {
      // Warn, not info: these proposals are stuck open and will stay stuck on
      // every sweep until something records an electorate for them.
      log.warn(
        `[close-garden-proposals] ${skipped.length} proposal(s) cannot be ` +
          `closed because no eligible_voters is recorded, so quorum is not ` +
          `measurable: ${skipped.map((r) => r.proposal_id).join(", ")}`
      )
    }

    for (const f of failed) {
      log.error(
        `[close-garden-proposals] FAILED ${f.proposal_id}: ${f.error}`
      )
    }
  } catch (error: any) {
    // Housekeeping must never take down the worker.
    log.error(
      `[close-garden-proposals] sweep failed: ${error?.message ?? error}`
    )
  }
}

export const config = {
  name: "close-garden-proposals",
  schedule: "20 * * * *",
}
