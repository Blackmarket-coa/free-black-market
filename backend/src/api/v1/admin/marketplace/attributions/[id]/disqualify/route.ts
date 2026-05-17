import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../../../../modules/creator-attribution/service"
import { CommissionStatus } from "../../../../../../../modules/creator-attribution/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const Schema = z.object({
  reason: z.string().min(2).max(512),
})

/**
 * POST /v1/admin/marketplace/attributions/:id/disqualify
 *
 * Block a suspected fraudulent attribution from paying out. If the
 * commission has already been ledger-credited (status=approved|paid), the
 * admin should use the reverse path instead.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid disqualify payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  const list = await service.listOrderAttributions({ id })
  if (list.length === 0) {
    return res.status(404).json({ message: "Attribution not found", type: "not_found" })
  }
  const attr = list[0]
  if (
    attr.commission_status === CommissionStatus.PAID ||
    attr.commission_status === CommissionStatus.APPROVED
  ) {
    return res.status(409).json({
      message:
        "Cannot disqualify already-credited commission; use reverse instead",
      type: "conflict",
    })
  }

  const updated = await service.disqualifyAttribution(id, parsed.data.reason)

  // Best-effort fraud webhook
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "creator.commission.disqualified",
      attr.creator_seller_id,
      {
        attribution_id: id,
        order_id: attr.order_id,
        reason: parsed.data.reason,
      }
    )
  } catch (err) {
    console.error("[admin/disqualify] webhook dispatch failed", err)
  }

  return res.status(200).json({ attribution: updated })
}
