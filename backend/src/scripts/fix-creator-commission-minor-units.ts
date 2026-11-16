import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import {
  planCommissionMinorUnitCorrection,
  reviewVendorDebit,
  vendorsDebitedOnApproval,
  type MajorUnitOrderTotals,
  type StoredAttributionAmounts,
  type VendorDebitContext,
} from "../modules/creator-attribution/minor-unit-correction"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
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
 * every attributed order recorded 1/100 of its commission. A row the hourly
 * approve-held job already credited to the creator's ledger at the old
 * figure is only listed, because what to do about money already moved is
 * the operator's decision, and changing the column alone would make a later
 * refund reverse more than was credited. A one-shot migration would also run
 * before a rolling deploy finished, while an old instance could still be
 * writing old-unit rows; this can be run again afterwards and skips what it
 * already did. `planCommissionMinorUnitCorrection` decides each order's
 * figures and says why.
 *
 * WHAT CORRECTING A HELD ROW SETS UP. A `pending` or `held` row has moved no
 * money to the creator, but its commission was never taken from the vendor
 * either: settlement credits the vendor's SELLER_EARNINGS the sale less the
 * platform fee and processing, and approve-held is what later debits the
 * vendor for the commission, at whatever the column says when it runs. So
 * correcting a held row raises that future debit from 1/100 to the full
 * commission, out of the vendor's balance at the time. Today approve-held's
 * credit is refused for every row (a separate defect in the SD-95 follow-up,
 * "no creator commission is ever credited"); once that is fixed, every held
 * row this script corrected is debited at the full figure in the next run.
 * `reviewVendorDebit` therefore lists, instead of correcting, any order
 * where that debit cannot be justified without a person: the attributed
 * vendor is not the order's seller, the vendor has been paid out since the
 * order was placed (a payout request that moved money or a withdrawal off
 * their earnings), or Mercur already paid the order's proceeds out. What is
 * corrected is an order whose seller is the vendor debited and whose
 * proceeds have not left that vendor's balance since.
 *
 * Each order's rows are written in one transaction, each row by one UPDATE
 * conditional on the status and figures it was planned from
 * (`correctAttributionAmountsIfUnchanged`): a row approve-held approved or a
 * refund reversed in between is not written, the order's other rows roll
 * back with it, and the order is listed.
 *
 * Run it outside the approve-held job's minute (it runs hourly at :00). That
 * job takes its list of due rows, amounts included, when it starts; a row
 * this script corrects while such a run is iterating is credited the old
 * figure from that list while the column says the new one, and a later
 * refund would reverse the new one. That cannot happen while every credit is
 * refused (above), so the safest time to run this is before that is fixed.
 *
 * Each corrected row keeps its own record: the old and new figures go on its
 * `metadata.amount_units_corrected`, and it is marked
 * `metadata.amount_unit = "minor"` like rows the subscriber writes, which
 * also makes a second run skip it.
 */

const ACTOR_ID = "script:fix-creator-commission-minor-units"
const PAGE = 200

type Row = StoredAttributionAmounts & { created_at?: Date | string }

/** Payout request statuses whose legs have taken the money off the vendor's earnings. */
const PAID_OUT_STATUSES = ["PROCESSING", "IN_TRANSIT", "COMPLETED"] as const

export type CommissionMinorUnitFixSummary = {
  /** Orders corrected, or on a dry run would be, with their figures. */
  corrected: Array<{
    order_id: string
    subtotal: { from: number; to: number }
    commission_total: { from: number; to: number }
    rows: string[]
  }>
  skipped: Array<{ order_id: string; reason: string }>
  /**
   * Left alone for a person: unclear figures, commission already credited, or
   * a vendor debit the correction would set up that needs a decision.
   */
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
 * Who approve-held would debit for this order and whether they have been
 * paid since it was placed (`reviewVendorDebit`). `placedAtFallback` is the
 * L1 row's `created_at`: the subscriber writes it at `order.placed`.
 */
async function readVendorDebitContext(
  container: MedusaContainer,
  orderId: string,
  vendorIds: readonly string[],
  placedAtFallback: Date | string | undefined
): Promise<VendorDebitContext> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "seller.id", "payouts.id"],
    filters: { id: orderId },
  })
  const row = (data as Array<{
    created_at?: Date | string | null
    seller?: { id?: string | null } | null
    payouts?: Array<{ id?: string | null } | null> | null
  }>)[0]
  const placed = row?.created_at ?? placedAtFallback ?? null
  const since = placed ? new Date(placed) : null
  const placedAt = since && !Number.isNaN(since.getTime()) ? since : null

  const hawala = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const vendor_withdrawals: Record<string, Array<{ id: string; kind: string; status: string }>> = {}
  if (placedAt) {
    for (const vendorId of vendorIds) {
      const requests = await hawala.listPayoutRequests(
        { vendor_id: vendorId, status: [...PAID_OUT_STATUSES], created_at: { $gte: placedAt } },
        { take: 5, order: { created_at: "ASC" } }
      )
      const accounts = await hawala.listLedgerAccounts({ owner_id: vendorId, account_type: "SELLER_EARNINGS" })
      const withdrawals = accounts.length
        ? await hawala.listLedgerEntries(
            {
              debit_account_id: accounts.map((a) => a.id),
              entry_type: "WITHDRAWAL",
              status: "COMPLETED",
              created_at: { $gte: placedAt },
            },
            { take: 5, order: { created_at: "ASC" } }
          )
        : []
      vendor_withdrawals[vendorId] = [
        ...requests.map((r) => ({ id: r.id, kind: "payout request", status: String(r.status) })),
        ...withdrawals.map((e) => ({ id: e.id, kind: "withdrawal", status: String(e.status) })),
      ]
    }
  }

  return {
    order_seller_id: row?.seller?.id ?? null,
    order_placed_at: placedAt ? placedAt.toISOString() : null,
    order_payout_ids: (row?.payouts ?? []).map((p) => p?.id).filter((id): id is string => !!id),
    vendor_withdrawals,
  }
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

      // Who approve-held would debit for the rows it will still credit,
      // and whether that debit can stand without a person.
      const debited = vendorsDebitedOnApproval(rows)
      if (debited.length) {
        const ctx = await readVendorDebitContext(container, orderId, debited, head.created_at)
        const reason = reviewVendorDebit(plan, rows, ctx)
        if (reason) {
          summary.review.push({ order_id: orderId, reason })
          continue
        }
      }

      if (opts.apply === true) {
        const at = new Date().toISOString()
        const result = await service.correctAttributionAmountsIfUnchanged(
          plan.rows.map((fix) => ({
            id: fix.id,
            status: fix.status,
            from: { subtotal_cents: plan.subtotal.from, commission_cents: fix.commission.from },
            to: { subtotal_cents: plan.subtotal.to, commission_cents: fix.commission.to },
            record: {
              at,
              by: ACTOR_ID,
              attributed_subtotal_cents: plan.subtotal,
              commission_basis_cents: plan.subtotal,
              commission_amount_cents: fix.commission,
            },
          }))
        )
        if (!result.written) {
          const planned = plan.rows.find((r) => r.id === result.stale_id)
          summary.review.push({
            order_id: orderId,
            reason:
              `row ${result.stale_id} changed since it was read (planned from ${planned?.status ?? "?"}); ` +
              `none of the order's rows were written`,
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
  if (summary.corrected.length) {
    logger.warn(
      `${tag} ${apply ? "Corrected" : "Correcting"} held or pending rows raises what the approve-held job will debit ` +
        `from each vendor's current SELLER_EARNINGS to the full commission once commission crediting works ` +
        `(today every credit is refused; see the SD-95 follow-up). Orders whose vendor is not the order's seller, ` +
        `whose vendor was paid out after the order, or whose proceeds Mercur paid out are listed for review instead.`
    )
  }
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
