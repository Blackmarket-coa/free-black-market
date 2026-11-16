import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import { CommissionStatus } from "../modules/creator-attribution/models/order-attribution"
import {
  CORRECTED_METADATA_KEY,
  planCommissionMinorUnitCorrection,
  type MajorUnitOrderTotals,
  type StoredAttributionAmounts,
} from "../modules/creator-attribution/minor-unit-correction"
import { APPLY_OR_DRY_RUN, parseScriptArgs } from "../shared/exec-args"

/**
 * Put stored creator-commission amounts into minor units (SD-95).
 *
 *     npx medusa exec ./src/scripts/fix-creator-commission-minor-units.ts
 *     npx medusa exec ./src/scripts/fix-creator-commission-minor-units.ts apply
 *
 * The first is a dry run: it writes nothing and lists what it would do.
 * Writing needs the word `apply`; `dry-run` says the default out loud. Any
 * other word, or `apply` with `dry-run`, is refused before anything is read
 * (`parseScriptArgs`), so a typo can only ever stop the run, never make it
 * write. Bare words, not `--apply`: `medusa exec` refuses unknown `--`
 * options and drops everything after a `--` separator.
 *
 * Why a script and not a migration script: some rows cannot be corrected by
 * a rule. The subscriber stored Medusa's major-unit subtotal as cents, so
 * every attributed order recorded 1/100 of its commission. A row that has
 * not moved money (pending, held, or reversed/disqualified with no ledger
 * entry) is corrected; a row the hourly approve-held job already credited to
 * the creator's ledger at the old figure is only listed, because what to do
 * about money already moved (and about vendor payouts made since) is the
 * operator's decision, and changing the column alone would make a later
 * refund reverse more than was credited. A one-shot migration would also run
 * before a rolling deploy finished, while an old instance could still be
 * writing old-unit rows; this can be run again afterwards and skips what it
 * already did. `planCommissionMinorUnitCorrection` decides each order and
 * says why.
 *
 * Run it outside the approve-held job's minute (it runs hourly at :00): a
 * row that job credits between this script's read and its write keeps the
 * old ledger figure. The write is conditional on the row's status, so a row
 * already approved by then is not written and is listed instead.
 *
 * Each corrected row keeps its own record: the old and new figures go on its
 * `metadata.amount_units_corrected`, which also makes a second run skip it.
 */

const ACTOR_ID = "script:fix-creator-commission-minor-units"
const PAGE = 200

type Row = StoredAttributionAmounts & { created_at?: Date | string }

export type CommissionMinorUnitFixSummary = {
  /** Orders corrected, or on a dry run would be, with their figures. */
  corrected: Array<{
    order_id: string
    subtotal: { from: number; to: number }
    commission_total: { from: number; to: number }
    rows: string[]
  }>
  skipped: Array<{ order_id: string; reason: string }>
  /** Left alone for a person: unclear figures, or commission already credited. */
  review: Array<{ order_id: string; reason: string }>
}

async function readOrderTotals(
  container: MedusaContainer,
  orderId: string
): Promise<MajorUnitOrderTotals | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // The same fields the subscriber reads; asking for a total makes Medusa's
  // order module load what it needs to compute it.
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "subtotal", "total", "currency_code"],
    filters: { id: orderId },
  })
  const row = (data as Array<Record<string, unknown>>)[0]
  if (!row) return null
  return { subtotal: row.subtotal, total: row.total, currency_code: (row.currency_code as string) ?? null }
}

/**
 * The correction itself. Writes only with `apply: true`, like the CLI: left
 * out, it reports what it would do and writes nothing.
 */
export async function fixCreatorCommissionMinorUnits(
  container: MedusaContainer,
  opts: { apply?: boolean } = {}
): Promise<CommissionMinorUnitFixSummary> {
  const service = container.resolve<CreatorAttributionService>(CREATOR_ATTRIBUTION_MODULE)
  const summary: CommissionMinorUnitFixSummary = { corrected: [], skipped: [], review: [] }

  // One L1 row per order (unique on order_id, level), so paging level-1 rows
  // pages orders; each order's whole chain is then read together. `id` breaks
  // ties so rows sharing a `created_at` are not skipped or repeated at a page
  // edge.
  for (let skip = 0; ; skip += PAGE) {
    const heads = (await service.listOrderAttributions(
      { level: 1 },
      { order: { created_at: "ASC", id: "ASC" }, skip, take: PAGE }
    )) as unknown as Row[]
    if (!heads.length) break

    for (const head of heads) {
      const orderId = head.order_id
      const rows = (await service.listOrderAttributions({ order_id: orderId })) as unknown as Row[]
      const order = await readOrderTotals(container, orderId)
      const plan = planCommissionMinorUnitCorrection(rows, order)

      if (plan.action === "skip") {
        summary.skipped.push({ order_id: orderId, reason: plan.reason })
        continue
      }
      if (plan.action === "review") {
        summary.review.push({ order_id: orderId, reason: plan.reason })
        continue
      }

      if (opts.apply === true) {
        const byId = new Map(rows.map((r) => [r.id, r]))
        const at = new Date().toISOString()
        let stale: string | null = null
        for (const fix of plan.rows) {
          const row = byId.get(fix.id)
          const updated = (await service.updateOrderAttributions({
            // Conditional on the status the plan was made from: a row the
            // approve-held job credited in between is not written.
            selector: { id: fix.id, commission_status: fix.status as CommissionStatus },
            data: {
              attributed_subtotal_cents: plan.subtotal.to,
              commission_basis_cents: plan.subtotal.to,
              commission_amount_cents: fix.commission.to,
              metadata: {
                ...(row?.metadata ?? {}),
                [CORRECTED_METADATA_KEY]: {
                  at,
                  by: ACTOR_ID,
                  attributed_subtotal_cents: plan.subtotal,
                  commission_basis_cents: plan.subtotal,
                  commission_amount_cents: fix.commission,
                },
              },
            },
          })) as unknown[]
          if (!updated?.length) {
            stale = fix.id
            break
          }
        }
        if (stale) {
          summary.review.push({
            order_id: orderId,
            reason: `row ${stale} changed status since it was read (planned from ${byId.get(stale)?.commission_status}); not written from there on`,
          })
          continue
        }
      }

      summary.corrected.push({
        order_id: orderId,
        subtotal: plan.subtotal,
        commission_total: plan.commission_total,
        rows: plan.rows.map((r) => r.id),
      })
    }

    if (heads.length < PAGE) break
  }

  return summary
}

export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const tag = "[fix-creator-commission-minor-units]"
  const parsed = parseScriptArgs(args, APPLY_OR_DRY_RUN)
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was looked at.
    logger.error(`${tag} refused: ${parsed.message}`)
    throw new Error(`fix-creator-commission-minor-units refused: ${parsed.message}`)
  }
  const apply = parsed.flags.has("apply")
  const summary = await fixCreatorCommissionMinorUnits(container, { apply })

  logger.info(
    `${tag}${apply ? "" : " (dry run: nothing written; add `apply` to write)"} ` +
      `corrected=${summary.corrected.length} skipped=${summary.skipped.length} review=${summary.review.length}`
  )
  for (const c of summary.corrected) {
    logger.info(
      `${tag} ${apply ? "corrected" : "would correct"} order ${c.order_id}: subtotal ${c.subtotal.from} → ${c.subtotal.to}, ` +
        `commission ${c.commission_total.from} → ${c.commission_total.to} (rows ${c.rows.join(", ")})`
    )
  }
  for (const s of summary.skipped) {
    logger.info(`${tag} skipped order ${s.order_id}: ${s.reason}`)
  }
  for (const r of summary.review) {
    logger.warn(`${tag} review order ${r.order_id}: ${r.reason}`)
  }
}
