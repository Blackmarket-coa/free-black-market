import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/v1/seller/services/subcontracts")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../modules/order-subcontract/service"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"

const ProposeSchema = z.object({
  parent_order_id: z.string().min(1).max(128),
  contract_id: z.string().min(1).max(64),
  order_item_ids: z.array(z.string()).min(1).max(200),
  unit_count: z.number().int().min(1).max(1_000_000),
  unit_price_cents: z.number().int().min(1).max(1_000_000_000),
  currency_code: z.string().length(3).optional(),
  pickup_at: z.string().datetime().optional().nullable(),
  deliver_to: z.record(z.string(), z.unknown()).optional().nullable(),
})

/**
 * GET /v1/seller/services/subcontracts
 *   Lists subcontracts where the seller is either parent (buyer-vendor) or
 *   subcontract_seller (service vendor).
 *
 * POST /v1/seller/services/subcontracts
 *   Buyer-vendor proposes a subcontract against an active service contract.
 *   On creation, escrow funds are moved from the buyer's seller-earnings
 *   account into a per-subcontract ESCROW account.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const service = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const [asParent, asProvider] = await Promise.all([
    service.listOrderSubcontracts({ parent_seller_id: sellerId }),
    service.listOrderSubcontracts({ subcontract_seller_id: sellerId }),
  ])
  return res.status(200).json({ as_parent: asParent, as_provider: asProvider })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = ProposeSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid subcontract payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  // Resolve the contract. The buyer-vendor must own it (vendor_id matches).
  const programSvc = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const contracts = await programSvc.listServiceContracts({
    id: parsed.data.contract_id,
    vendor_id: sellerId,
  })
  const contract = contracts[0]
  if (!contract) {
    return res.status(404).json({
      message: "Service contract not found or not owned by this vendor",
      type: "not_found",
    })
  }

  const subcontractSvc = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const sub = await subcontractSvc.proposeSubcontract({
    parentOrderId: parsed.data.parent_order_id,
    parentSellerId: sellerId,
    subcontractSellerId: contract.service_seller_id,
    contractId: parsed.data.contract_id,
    programId: contract.program_id,
    orderItemIds: parsed.data.order_item_ids,
    unitCount: parsed.data.unit_count,
    unitPriceCents: parsed.data.unit_price_cents,
    currencyCode: parsed.data.currency_code,
    pickupAt: parsed.data.pickup_at ? new Date(parsed.data.pickup_at) : null,
    deliverTo:
      (parsed.data.deliver_to as Record<string, unknown> | null) ?? null,
  })

  // Open escrow.
  try {
    const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    const total = parsed.data.unit_count * parsed.data.unit_price_cents
    const entry = await hawala.openSubcontractEscrow({
      subcontractId: sub.id,
      parentSellerId: sellerId,
      amountCents: total,
      currencyCode: (parsed.data.currency_code ?? "usd").toUpperCase(),
    })
    await subcontractSvc.attachEscrow({
      subcontractId: sub.id,
      escrowLedgerEntryId: entry.id,
    })
  } catch (err) {
    log.error("[subcontracts] escrow open failed", err)
    return res.status(402).json({
      message: `Subcontract proposed but escrow failed: ${(err as Error).message}`,
      type: "escrow_failed",
      subcontract: sub,
    })
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    const payload = {
      subcontract_id: sub.id,
      parent_order_id: parsed.data.parent_order_id,
      parent_seller_id: sellerId,
      subcontract_seller_id: contract.service_seller_id,
      contract_id: parsed.data.contract_id,
      total_cents: parsed.data.unit_count * parsed.data.unit_price_cents,
    }
    await webhooks.dispatch("subcontract.proposed", sellerId, payload)
    await webhooks.dispatch("subcontract.proposed", contract.service_seller_id, payload)
  } catch (err) {
    log.error("[subcontracts] webhook dispatch failed", err)
  }

  return res.status(201).json({ subcontract: sub })
}
