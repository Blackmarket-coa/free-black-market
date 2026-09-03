import type { ExecArgs } from "@medusajs/framework/types"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../modules/accounts-receivable"
import type AccountsReceivableService from "../modules/accounts-receivable/service"

type LegacyInvoice = {
  id?: string
  order_id?: string
  status?: string
  total?: number
  currency_code?: string
  issued_at?: string | null
  due_at?: string | null
  memo?: string
  created_at?: string
}

/**
 * Move invoices out of `seller_metadata.invoices_v1` into the `ar_invoice`
 * table.
 *
 * Before the accounts-receivable module, `/vendor/invoices` kept invoices as a
 * JSON array on the seller's metadata row. That store is left in place by the
 * migration rather than dropped, so this can be re-run and so a failure never
 * destroys a vendor's billing history. Run it once after migrating:
 *
 *     npx medusa exec ./src/scripts/backfill-ar-invoices.ts
 *
 * Idempotent by `metadata.legacy_invoice_id`: a second run skips anything it
 * already moved rather than duplicating it.
 *
 * Terms are NOT reconstructed. A legacy invoice recorded a `due_at` or it did
 * not; inventing terms for one that never had them would fabricate an
 * agreement the buyer never made. Rows with a due date keep it, and their
 * `terms_days` is derived from the gap between issue and due only when both
 * are present. Everything else lands as Net-0, which is what it effectively
 * was.
 */
export default async function backfillArInvoices({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const ar = container.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  const { data: metadataRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "seller_id", "metadata"],
  })

  let moved = 0
  let skipped = 0
  let failed = 0

  for (const record of (metadataRows ?? []) as {
    seller_id?: string
    metadata?: Record<string, unknown>
  }[]) {
    const sellerId = record.seller_id
    const raw = record.metadata?.invoices_v1
    if (!sellerId || !Array.isArray(raw)) continue

    for (const legacy of raw as LegacyInvoice[]) {
      if (!legacy?.id) continue

      try {
        const existing = await ar.listInvoices({
          seller_id: sellerId,
          metadata: { legacy_invoice_id: legacy.id },
        })
        if ((existing as unknown[]).length > 0) {
          skipped += 1
          continue
        }

        const issuedAt = legacy.issued_at ? new Date(legacy.issued_at) : null
        const dueAt = legacy.due_at ? new Date(legacy.due_at) : null
        const termsDays =
          issuedAt && dueAt
            ? Math.max(
                0,
                Math.round(
                  (dueAt.getTime() - issuedAt.getTime()) / (24 * 3600 * 1000)
                )
              )
            : 0

        const draft = await ar.createDraft({
          sellerId,
          orderId: legacy.order_id ?? null,
          totalCents: Math.max(0, Math.floor(Number(legacy.total) || 0)),
          currencyCode: (legacy.currency_code ?? "usd").toLowerCase(),
          memo: legacy.memo ?? null,
          metadata: { legacy_invoice_id: legacy.id },
        })

        // "sent" was the old name for issued. A legacy `paid` invoice is
        // recorded as issued-and-settled via a payment row rather than
        // stamped paid, so the AR ledger still explains where the money came
        // from — "backfill" is a truthful answer, an empty ledger is not.
        const status = (legacy.status ?? "draft").toLowerCase()
        if (status === "sent" || status === "paid") {
          await ar.issue({
            invoiceId: draft.id,
            tiers: [],
            termsDaysOverride: termsDays,
            ...(issuedAt ? { now: issuedAt } : {}),
          })
        }
        if (status === "paid") {
          await ar.recordPayment({
            invoiceId: draft.id,
            amountCents: Math.max(0, Math.floor(Number(legacy.total) || 0)),
            idempotencyKey: `backfill:${legacy.id}`,
            method: "backfill",
            note: "Recorded during migration from seller_metadata.invoices_v1",
            ...(issuedAt ? { receivedAt: issuedAt } : {}),
          })
        }
        if (status === "void") {
          await ar.void(draft.id, "Voided before migration")
        }

        moved += 1
      } catch (err) {
        failed += 1
        logger.error(
          `[backfill-ar-invoices] seller=${sellerId} invoice=${legacy.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }
  }

  logger.info(
    `[backfill-ar-invoices] moved=${moved} skipped=${skipped} failed=${failed}. ` +
      "The legacy invoices_v1 blob is left in place; remove it once you have " +
      "confirmed the ar_invoice rows."
  )
}

/** Exported for the unit spec — the status mapping is the part worth pinning. */
export const legacyStatusToActions = (status: string | undefined) => {
  const s = (status ?? "draft").toLowerCase()
  return {
    issue: s === "sent" || s === "paid",
    pay: s === "paid",
    void: s === "void",
  }
}
