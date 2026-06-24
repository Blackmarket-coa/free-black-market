import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import type TenancyModuleService from "../../../../modules/tenancy/service"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

type Body = {
  listing_id: string
}

/**
 * Sprint A4 → A6 publish step. Marks the listing as the vendor's first
 * published listing, flips wizard_step to `published`, and emits an
 * event for analytics + 48h follow-up automation.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as Body
  if (!body.listing_id) {
    return res.status(400).json({ message: "listing_id is required" })
  }

  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const state = await service.markFirstListingPublished({
    seller_id: sellerId,
    listing_id: body.listing_id,
  })

  try {
    const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({
      name: "vendor.onboarding.first_listing_published",
      data: { seller_id: sellerId, listing_id: body.listing_id },
    })
  } catch {
    // Event emission is best-effort.
  }

  return res.json({ state })
}
