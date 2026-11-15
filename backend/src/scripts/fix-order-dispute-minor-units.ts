import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_DISPUTE_MODULE } from "../modules/order-dispute"
import type OrderDisputeService from "../modules/order-dispute/service"
import {
  planMinorUnitCorrection,
  type StoredDisputeAmounts,
} from "../modules/order-dispute/minor-unit-correction"
import { readOrderForDispute } from "../shared/order-dispute-intake"

/**
 * Put stored dispute amounts into minor units.
 *
 *     npx medusa exec ./src/scripts/fix-order-dispute-minor-units.ts --dry-run
 *     npx medusa exec ./src/scripts/fix-order-dispute-minor-units.ts
 *
 * Run once, right after the intake fix deploys. The intake stored Medusa's
 * major-unit item totals, floored, as minor units: a $25.99 claim was 25, and
 * the admin Disputes screen, which reads the column as declared, showed
 * "$0.25" and capped the refund there. `planMinorUnitCorrection` decides each
 * row and says why; only rows it is certain about are changed.
 *
 * Each correction keeps its own record: the old and new figures go on the
 * dispute's `metadata.amount_units_corrected` (which also makes a second run
 * skip the row) and on an `amount_corrected` event, actor `system`, in the
 * append-only log the case file shows. Rows it cannot decide are listed for
 * a person to look at, and left exactly as they are.
 */

const ACTOR_ID = "script:fix-order-dispute-minor-units"
const PAGE = 200

type Row = StoredDisputeAmounts & {
  id: string
  order_id: string
  metadata: Record<string, unknown> | null
}

export type MinorUnitFixSummary = {
  corrected: string[]
  skipped: number
  review: { id: string; reason: string }[]
}

export async function fixOrderDisputeMinorUnits(
  container: MedusaContainer,
  opts: { dryRun?: boolean } = {}
): Promise<MinorUnitFixSummary> {
  const disputes = container.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const summary: MinorUnitFixSummary = { corrected: [], skipped: 0, review: [] }

  for (let skip = 0; ; skip += PAGE) {
    const rows = (await disputes.listOrderDisputes(
      {},
      { order: { created_at: "ASC" }, skip, take: PAGE }
    )) as unknown as Row[]
    if (!rows.length) break

    for (const row of rows) {
      if (row.metadata && "amount_units_corrected" in row.metadata) {
        summary.skipped += 1
        continue
      }

      const order = await readOrderForDispute(container, row.order_id)
      if (!order) {
        summary.review.push({ id: row.id, reason: `order ${row.order_id} not found` })
        continue
      }

      const plan = planMinorUnitCorrection(row, order.lines)
      if (plan.action === "skip") {
        summary.skipped += 1
        continue
      }
      if (plan.action === "review") {
        summary.review.push({ id: row.id, reason: plan.reason })
        continue
      }

      summary.corrected.push(row.id)
      if (opts.dryRun) continue

      const record = {
        at: new Date().toISOString(),
        by: ACTOR_ID,
        claim_amount: plan.claim,
        award_amount: plan.award,
      }
      await disputes.updateOrderDisputes({
        id: row.id,
        claim_amount: plan.claim.to,
        award_amount: plan.award.to,
        metadata: { ...(row.metadata ?? {}), amount_units_corrected: record },
      })
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
            `. They had been stored as whole ${row.currency_code.toUpperCase()} with the fraction cut off.`,
          metadata: { claim_amount: plan.claim, award_amount: plan.award },
        },
      ])
    }

    if (rows.length < PAGE) break
  }

  return summary
}

export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const dryRun = (args ?? []).includes("--dry-run")
  const summary = await fixOrderDisputeMinorUnits(container, { dryRun })

  logger.info(
    `[fix-order-dispute-minor-units]${dryRun ? " (dry run)" : ""} ` +
      `corrected=${summary.corrected.length} skipped=${summary.skipped} review=${summary.review.length}`
  )
  for (const id of summary.corrected) {
    logger.info(`[fix-order-dispute-minor-units] ${dryRun ? "would correct" : "corrected"} ${id}`)
  }
  for (const r of summary.review) {
    logger.warn(`[fix-order-dispute-minor-units] review ${r.id}: ${r.reason}`)
  }
}
