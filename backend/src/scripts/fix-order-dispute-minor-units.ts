import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_DISPUTE_MODULE } from "../modules/order-dispute"
import type OrderDisputeService from "../modules/order-dispute/service"
import {
  parseScriptArgs,
  planMinorUnitCorrection,
  type StoredDisputeAmounts,
} from "../modules/order-dispute/minor-unit-correction"
import { DisputeStatus } from "../modules/order-dispute/resolution"
import { readOrderForDispute } from "../shared/order-dispute-intake"

/**
 * Put stored dispute amounts into minor units.
 *
 *     npx medusa exec ./src/scripts/fix-order-dispute-minor-units.ts before=<ISO time>
 *     npx medusa exec ./src/scripts/fix-order-dispute-minor-units.ts apply before=<ISO time>
 *
 * The first is a dry run: it writes nothing and lists what it would do.
 * Writing needs the word `apply`. `before=` is required: the time the
 * minor-unit intake fix went live, with a zone (`2026-11-20T15:00:00Z`).
 * Only rows created before it are looked at. Any other word, a repeated
 * `before=`, or `apply` with `dry-run` is refused before anything is read
 * (`parseScriptArgs`), so a typo can only ever stop the run, never make it
 * write. Bare words, not `--apply`/`--before=`: `medusa exec` refuses unknown
 * `--` options, and drops everything after a `--` separator.
 *
 * Run once, right after the intake fix deploys, ideally before anyone works
 * the Disputes queue. The intake stored Medusa's major-unit item totals,
 * floored, as minor units: a $25.99 claim was 25, and the admin Disputes
 * screen, which reads the column as declared, showed "$0.25" and capped the
 * refund there. `planMinorUnitCorrection` decides each row and says why; only
 * rows it is certain about are changed.
 *
 * Each correction keeps its own record: the old and new figures go on the
 * dispute's `metadata.amount_units_corrected` (which also makes a second run
 * skip the row) and on an `amount_corrected` event, actor `system`, in the
 * append-only log the case file shows. The write is conditional on the row
 * still having the status and figures it was planned from
 * (`OrderDisputeService.correctAmountsIfUnchanged`); a row an admin decided
 * in between is not written and is listed for review instead. A correction
 * to a case already decided as a refund is flagged in the log line and in
 * the event: a refund paid by hand at the old figure has to be checked
 * against the corrected award.
 *
 * Rows written since the fix are protected twice over, because their amounts
 * can look exactly like an old row's (a buyer's typed claim of 25 on a
 * $25.99 order): the query takes only rows created before the cutoff, and
 * the planner skips any row marked `metadata.amount_unit = "minor"`, which
 * `OrderDisputeService.open` now writes on every row.
 */

const ACTOR_ID = "script:fix-order-dispute-minor-units"
const PAGE = 200

type Row = StoredDisputeAmounts & {
  id: string
  order_id: string
  metadata: Record<string, unknown> | null
}

export type MinorUnitFixSummary = {
  /** Corrected, or on a dry run would be. */
  corrected: string[]
  /** The subset of `corrected` already decided as a refund: check the refund paid. */
  refundToCheck: { id: string; award: { from: number; to: number } }[]
  skipped: { id: string; reason: string }[]
  review: { id: string; reason: string }[]
}

/**
 * The correction itself. Writes only with `apply: true`, like the CLI: left
 * out, it reports what it would do and writes nothing.
 */
export async function fixOrderDisputeMinorUnits(
  container: MedusaContainer,
  opts: { before: Date; apply?: boolean }
): Promise<MinorUnitFixSummary> {
  if (!(opts?.before instanceof Date) || Number.isNaN(opts.before.getTime())) {
    throw new Error("fixOrderDisputeMinorUnits needs a cutoff: the time the minor-unit intake fix went live")
  }
  const disputes = container.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const summary: MinorUnitFixSummary = { corrected: [], refundToCheck: [], skipped: [], review: [] }

  for (let skip = 0; ; skip += PAGE) {
    // `id` breaks ties: offset paging over rows that share a `created_at`
    // (a bulk restore) could otherwise skip or repeat one at a page edge.
    const rows = (await disputes.listOrderDisputes(
      { created_at: { $lt: opts.before } },
      { order: { created_at: "ASC", id: "ASC" }, skip, take: PAGE }
    )) as unknown as Row[]
    if (!rows.length) break

    for (const row of rows) {
      if (row.metadata && "amount_units_corrected" in row.metadata) {
        summary.skipped.push({ id: row.id, reason: "already_corrected" })
        continue
      }

      const order = await readOrderForDispute(container, row.order_id)
      if (!order) {
        summary.review.push({ id: row.id, reason: `order ${row.order_id} not found` })
        continue
      }

      const plan = planMinorUnitCorrection(row, order.lines, { before: opts.before })
      if (plan.action === "skip") {
        summary.skipped.push({ id: row.id, reason: plan.reason })
        continue
      }
      if (plan.action === "review") {
        summary.review.push({ id: row.id, reason: plan.reason })
        continue
      }

      const decidedRefund = row.status === DisputeStatus.RESOLVED_REFUND

      if (opts.apply === true) {
        const record = {
          at: new Date().toISOString(),
          by: ACTOR_ID,
          claim_amount: plan.claim,
          award_amount: plan.award,
          ...(decidedRefund ? { refund_check: true } : {}),
        }
        const written = await disputes.correctAmountsIfUnchanged({
          id: row.id,
          status: String(row.status),
          from: { claim_amount: plan.claim.from, award_amount: plan.award.from },
          to: { claim_amount: plan.claim.to, award_amount: plan.award.to },
          record,
        })
        if (!written) {
          summary.review.push({
            id: row.id,
            reason:
              `changed since it was read (planned from status ${row.status}, claim ${plan.claim.from}, ` +
              `award ${plan.award.from}); not written`,
          })
          continue
        }
        await disputes.createOrderDisputeEvents([
          {
            dispute_id: row.id,
            kind: "amount_corrected",
            actor_type: "system",
            actor_id: ACTOR_ID,
            message:
              `Amounts corrected to minor units: claim ${plan.claim.from} → ${plan.claim.to}` +
              (plan.award.from || plan.award.to
                ? `, award ${plan.award.from} → ${plan.award.to}`
                : "") +
              `. They had been stored as whole ${row.currency_code.toUpperCase()} with the fraction cut off.` +
              (decidedRefund
                ? " This case was already decided as a refund: check that the refund paid through the order's payment matches the corrected award."
                : ""),
            metadata: {
              claim_amount: plan.claim,
              award_amount: plan.award,
              ...(decidedRefund ? { refund_check: true } : {}),
            },
          },
        ])
      }

      summary.corrected.push(row.id)
      if (decidedRefund) summary.refundToCheck.push({ id: row.id, award: plan.award })
    }

    if (rows.length < PAGE) break
  }

  return summary
}

export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const parsed = parseScriptArgs(args)
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was looked at.
    logger.error(`[fix-order-dispute-minor-units] refused: ${parsed.message}`)
    throw new Error(`fix-order-dispute-minor-units refused: ${parsed.message}`)
  }
  const dryRun = !parsed.apply
  const summary = await fixOrderDisputeMinorUnits(container, { before: parsed.before, apply: parsed.apply })

  const tag = "[fix-order-dispute-minor-units]"
  logger.info(
    `${tag}${dryRun ? " (dry run: nothing written; add `apply` to write)" : ""} rows created before ${parsed.before.toISOString()}: ` +
      `corrected=${summary.corrected.length} skipped=${summary.skipped.length} review=${summary.review.length}`
  )
  const refunds = new Map(summary.refundToCheck.map((r) => [r.id, r.award]))
  for (const id of summary.corrected) {
    const award = refunds.get(id)
    logger.info(
      `${tag} ${dryRun ? "would correct" : "corrected"} ${id}` +
        (award
          ? `: decided as a refund; check the Stripe refund matches the corrected award (${award.from} → ${award.to})`
          : "")
    )
  }
  for (const r of summary.skipped) {
    logger.info(`${tag} skipped ${r.id}: ${r.reason}`)
  }
  for (const r of summary.review) {
    logger.warn(`${tag} review ${r.id}: ${r.reason}`)
  }
}
