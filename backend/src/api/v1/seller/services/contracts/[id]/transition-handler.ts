import { createLogger } from "../../../../../../shared/logger"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../../modules/service-program/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"
import { emitBlackoutEvent } from "../../../../../../lib/blackout-emit"
import {
  resolveSellerBlackoutUserId,
  resolveSellerMxid,
} from "../../../../../../lib/blackout-identity"
import {
  evaluateContractTransition,
  type ServiceContractTransition,
} from "../../../../../../modules/service-program/contract-transitions"

const log = createLogger("api/v1/seller/services/contracts/[id]/transition")

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_participant: 403,
  forbidden_role: 403,
  invalid_state: 409,
}

/** Per-transition webhook event; start/cancel have no defined event type. */
const WEBHOOK_EVENT: Partial<Record<ServiceContractTransition, string>> = {
  deliver: "service.contract.delivered",
  accept: "service.contract.accepted",
  dispute: "service.contract.disputed",
}

/**
 * Shared handler for the service-contract lifecycle endpoints. Authorizes the
 * transition (participant + role + from-status), applies it via the existing
 * `ServiceProgramService` method, then fires the per-seller webhook to both
 * parties (delivered/accepted/disputed) plus the Blackout dispute bridge for
 * disputes. Mirrors the subcontract dispute route's emit posture — emits are
 * best-effort and never fail the transaction.
 */
export async function handleContractTransition(
  req: MedusaRequest,
  res: MedusaResponse,
  transition: ServiceContractTransition
): Promise<MedusaResponse | void> {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const [contract] = await service.listServiceContracts({ id })

  const evaluation = evaluateContractTransition({
    contract: contract
      ? {
          id: contract.id,
          status: contract.status,
          service_seller_id: contract.service_seller_id,
          vendor_id: contract.vendor_id,
        }
      : null,
    actorSellerId: sellerId,
    transition,
  })
  if (!evaluation.ok) {
    return res
      .status(ERROR_STATUS[evaluation.code] ?? 400)
      .json({ message: evaluation.message, type: evaluation.code })
  }

  const body = (req.body ?? {}) as { reason?: unknown; units_delivered?: unknown }

  // Dispute requires a reason.
  let reason: string | null = null
  if (transition === "dispute") {
    reason =
      typeof body.reason === "string" && body.reason.trim().length >= 2
        ? body.reason.trim()
        : null
    if (!reason) {
      return res.status(400).json({
        message: "A dispute reason (2+ chars) is required",
        type: "invalid_request",
      })
    }
  }

  // Apply the transition through the existing service methods.
  let updated: unknown
  switch (transition) {
    case "start":
      updated = await service.markContractInProgress(id)
      break
    case "deliver":
      updated = await service.markContractDelivered({
        contractId: id,
        unitsDelivered:
          typeof body.units_delivered === "number" ? body.units_delivered : undefined,
      })
      break
    case "accept":
      updated = await service.markContractAccepted(id)
      break
    case "dispute":
      updated = await service.markContractDisputed(id, reason as string)
      break
    case "cancel":
      updated = await service.cancelContract(id)
      break
  }

  // Per-seller webhook to both parties (events exist for delivered/accepted/disputed).
  const eventName = WEBHOOK_EVENT[transition]
  if (eventName) {
    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
        MARKETPLACE_WEBHOOKS_MODULE
      )
      const payload = {
        contract_id: contract.id,
        program_id: contract.program_id,
        service_seller_id: contract.service_seller_id,
        vendor_id: contract.vendor_id,
        status: evaluation.to,
        actor_seller_id: sellerId,
        ...(reason ? { reason } : {}),
      }
      await webhooks.dispatch(eventName, contract.service_seller_id, payload)
      await webhooks.dispatch(eventName, contract.vendor_id, payload)
    } catch (err) {
      log.error(`[contract/${transition}] webhook dispatch failed`, err)
    }
  }

  // §3 Blackout bridge for disputes (dispute.opened exists in the Blackout set;
  // delivered/accepted have no Blackout global type — per-seller webhook only).
  if (transition === "dispute") {
    try {
      const counterpartySellerId =
        contract.service_seller_id === sellerId
          ? contract.vendor_id
          : contract.service_seller_id
      const [actorBlackoutId, counterpartyMxid] = await Promise.all([
        resolveSellerBlackoutUserId(req.scope, sellerId),
        resolveSellerMxid(req.scope, counterpartySellerId),
      ])
      await emitBlackoutEvent(
        req.scope,
        "dispute.opened",
        {
          disputeId: contract.id,
          vendorId: counterpartySellerId,
          ...(actorBlackoutId ? { userId: actorBlackoutId } : {}),
          orderId: contract.id,
          reason,
          ...(counterpartyMxid ? { vendorMxid: counterpartyMxid } : {}),
        },
        { eventId: `service.contract.disputed:${contract.id}` }
      )
    } catch (err) {
      log.error("[contract/dispute] blackout emit failed", err)
    }
  }

  return res.status(200).json({ contract: updated })
}
