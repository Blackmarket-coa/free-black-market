import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/admin/marketplace/subcontracts/[id]/resolve")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../../../modules/order-subcontract/service"
import {
  OrderSubcontractStatus,
  SubcontractEventType,
} from "../../../../../../../modules/order-subcontract/models"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"
import { emitBlackoutEvent } from "../../../../../../../lib/blackout-emit"

const Schema = z.object({
  decision: z.enum(["release", "refund", "split"]),
  reason: z.string().min(2).max(2000),
  // For "split": cents to release to service vendor; remainder refunds.
  release_amount_cents: z.number().int().min(0).max(1_000_000_000_000).optional(),
})

/**
 * POST /v1/admin/marketplace/subcontracts/:id/resolve
 *
 * Admin resolves a disputed subcontract. Three decisions:
 *   - release: full escrow → service vendor (matches "accept-delivery" path)
 *   - refund: full escrow → buyer-vendor
 *   - split: partial release + partial refund
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid resolve payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const subSvc = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const list = await subSvc.listOrderSubcontracts({ id })
  const sub = list[0]
  if (!sub) {
    return res.status(404).json({ message: "Subcontract not found", type: "not_found" })
  }

  const total = Number(sub.total_cents)
  const currency = String(sub.currency_code).toUpperCase()
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  let releaseAmount = 0
  let refundAmount = 0
  if (parsed.data.decision === "release") {
    releaseAmount = total
  } else if (parsed.data.decision === "refund") {
    refundAmount = total
  } else {
    releaseAmount = Math.max(0, Math.min(total, parsed.data.release_amount_cents ?? 0))
    refundAmount = total - releaseAmount
  }

  const ops: { kind: "release" | "refund"; entry_id: string }[] = []
  try {
    if (releaseAmount > 0) {
      const e = await hawala.releaseSubcontractEscrow({
        subcontractId: id,
        serviceSellerId: sub.subcontract_seller_id,
        amountCents: releaseAmount,
        currencyCode: currency,
      })
      ops.push({ kind: "release", entry_id: e.id })
    }
    if (refundAmount > 0) {
      const e = await hawala.refundSubcontractEscrow({
        subcontractId: id,
        parentSellerId: sub.parent_seller_id,
        amountCents: refundAmount,
        reason: parsed.data.reason,
        currencyCode: currency,
      })
      ops.push({ kind: "refund", entry_id: e.id })
    }
  } catch (err) {
    return res.status(402).json({
      message: `Escrow operation failed: ${(err as Error).message}`,
      type: "escrow_failed",
    })
  }

  // Status transition
  let newStatus = OrderSubcontractStatus.CANCELED
  if (releaseAmount > 0 && refundAmount === 0) {
    newStatus = OrderSubcontractStatus.ACCEPTED_BY_PARENT
  }
  await subSvc.recordEvent({
    subcontractId: id,
    eventType: SubcontractEventType.RESOLVED,
    note: `${parsed.data.decision}: ${parsed.data.reason}`,
    metadata: {
      release_amount_cents: releaseAmount,
      refund_amount_cents: refundAmount,
      ledger_entries: ops,
    },
  })
  const finalSub = await subSvc.updateOrderSubcontracts({
    id,
    status: newStatus,
    release_ledger_entry_id:
      ops.find((o) => o.kind === "release")?.entry_id ?? null,
  })

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    const payload = {
      subcontract_id: id,
      decision: parsed.data.decision,
      release_amount_cents: releaseAmount,
      refund_amount_cents: refundAmount,
      ledger_entries: ops,
    }
    await webhooks.dispatch("subcontract.completed", sub.parent_seller_id, payload)
    await webhooks.dispatch("subcontract.completed", sub.subcontract_seller_id, payload)
  } catch (err) {
    log.error("[admin/resolve] webhook dispatch failed", err)
  }

  // §3 bridge: dispute resolution + ledger escrow disposition.
  const outcome =
    parsed.data.decision === "refund"
      ? "refunded"
      : parsed.data.decision === "release"
      ? "released"
      : "split"
  await emitBlackoutEvent(
    req.scope,
    "dispute.resolved",
    { disputeId: id, outcome },
    { eventId: `dispute.resolved:${id}` }
  )
  const releaseEntry = ops.find((o) => o.kind === "release")
  if (releaseEntry) {
    await emitBlackoutEvent(
      req.scope,
      "ledger.escrow_released",
      {
        vendorId: sub.subcontract_seller_id,
        orderId: id,
        amountMinorUnits: releaseAmount,
        currency,
        ledgerTxId: releaseEntry.entry_id,
      },
      { eventId: `ledger.escrow_released:${id}` }
    )
  }
  const refundEntry = ops.find((o) => o.kind === "refund")
  if (refundEntry) {
    await emitBlackoutEvent(
      req.scope,
      "ledger.refund",
      {
        vendorId: sub.parent_seller_id,
        orderId: id,
        amountMinorUnits: refundAmount,
        currency,
        ledgerTxId: refundEntry.entry_id,
      },
      { eventId: `ledger.refund:${id}` }
    )
  }

  return res.status(200).json({
    subcontract: finalSub,
    release_amount_cents: releaseAmount,
    refund_amount_cents: refundAmount,
    ledger_entries: ops,
  })
}
