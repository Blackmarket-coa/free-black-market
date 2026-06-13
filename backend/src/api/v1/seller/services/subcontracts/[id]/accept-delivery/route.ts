import { createLogger } from "../../../../../../../shared/logger"
const log = createLogger("api/v1/seller/services/subcontracts/[id]/accept-delivery")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../../../modules/order-subcontract/service"
import { OrderSubcontractStatus } from "../../../../../../../modules/order-subcontract/models"
import { SERVICE_PROGRAM_MODULE } from "../../../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../../../modules/service-program/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

/**
 * POST /v1/seller/services/subcontracts/:id/accept-delivery
 *
 * Buyer-vendor accepts the delivered work. Releases escrow to the
 * service vendor's seller-earnings account, advances the contract to
 * `accepted`, emits `subcontract.completed` webhook to both parties.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const subSvc = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const list = await subSvc.listOrderSubcontracts({
    id,
    parent_seller_id: sellerId,
  })
  const sub = list[0]
  if (!sub) {
    return res.status(404).json({ message: "Subcontract not found", type: "not_found" })
  }
  if (sub.status !== OrderSubcontractStatus.DELIVERED) {
    return res.status(409).json({
      message: `Cannot accept subcontract in status ${sub.status}`,
      type: "conflict",
    })
  }

  // Release escrow.
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  let releaseEntry
  try {
    releaseEntry = await hawala.releaseSubcontractEscrow({
      subcontractId: id,
      serviceSellerId: sub.subcontract_seller_id,
      amountCents: Number(sub.total_cents),
      currencyCode: String(sub.currency_code).toUpperCase(),
    })
  } catch (err) {
    return res.status(402).json({
      message: `Escrow release failed: ${(err as Error).message}`,
      type: "escrow_release_failed",
    })
  }

  const updated = await subSvc.markAcceptedByParent({
    subcontractId: id,
    parentSellerId: sellerId,
    releaseLedgerEntryId: releaseEntry.id,
  })

  // Update the parent service contract's payout total.
  try {
    const programSvc = req.scope.resolve<ServiceProgramService>(
      SERVICE_PROGRAM_MODULE
    )
    await programSvc.incrementContractPayout(sub.contract_id, Number(sub.total_cents))
  } catch (err) {
    log.error("[accept-delivery] contract payout update failed", err)
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const payload = {
      subcontract_id: id,
      release_ledger_entry_id: releaseEntry.id,
      total_cents: Number(sub.total_cents),
    }
    await webhooks.dispatch("subcontract.completed", sellerId, payload)
    await webhooks.dispatch("subcontract.completed", sub.subcontract_seller_id, payload)
  } catch (err) {
    log.error("[accept-delivery] webhook dispatch failed", err)
  }

  return res.status(200).json({
    subcontract: updated,
    release_ledger_entry_id: releaseEntry.id,
  })
}
