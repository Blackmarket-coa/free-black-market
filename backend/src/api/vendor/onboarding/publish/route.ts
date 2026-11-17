import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import type TenancyModuleService from "../../../../modules/tenancy/service"
import { sellerIdForVendorActor } from "../../../../shared/seller-actor"
import { sellerOwnsProduct } from "../../../../shared/product-sellers"

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
  const sellerId = await sellerIdForVendorActor(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as Body
  if (!body.listing_id) {
    return res.status(400).json({ message: "listing_id is required" })
  }
  // The wizard asks the vendor to paste a product id, and any string was
  // recorded as the store's first published listing ("prod_does_not_exist"
  // included, measured). It must name a product of this store; one answer
  // for an id that names no product and one of another store, so the check
  // says nothing about other stores' products.
  if (
    typeof body.listing_id !== "string" ||
    !(await sellerOwnsProduct(req.scope, sellerId, body.listing_id))
  ) {
    return res.status(400).json({
      type: "invalid_data",
      message: "listing_id must be the id of a product in your store.",
    })
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
