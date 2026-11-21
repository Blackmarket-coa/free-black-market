import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { forbidden } from "../../../../shared/community-read-access"
import { createLogger } from "../../../../shared/logger"
import { parseRouteInput, routeFailure } from "../../../../shared/route-input"
import { getSellerId } from "../../quests/_helpers"
import {
  nurseryService,
  onStoreProducts,
  saveAttributeAsProductOwner,
  storeOwnsProduct,
  upsertAttributeBody,
} from "../_access"

const log = createLogger("api/vendor/nursery/products")

/**
 * GET /vendor/nursery/products — the store's nursery listing attributes.
 *
 * Only rows on the store's own products (`onStoreProducts`): a row the store
 * wrote on another store's product before SD-158 is not listed.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  try {
    const rows = await nurseryService(req).listForSeller(sellerId)
    const attributes = await onStoreProducts(req, sellerId, rows)
    res.json({ attributes, count: attributes.length })
  } catch (error) {
    routeFailure(log, req, res, "Failed to list nursery attributes", error)
  }
}

/**
 * POST /vendor/nursery/products — create or update the nursery attributes of
 * one of the store's products.
 *
 * The product must be the store's (`seller_product`); a product that is
 * another store's, or that does not exist, gets `forbidden()` before anything
 * is read or written. `seller_id` is the vendor gate's, never the body's, and
 * the row written is the one `saveAttributeAsProductOwner` matches by store
 * and product (SD-158: this found the row by `product_id` alone and spread the
 * body into the write, so one store rewrote, re-owned and read another's).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = parseRouteInput(res, req.body, upsertAttributeBody)
  if (!body) return
  const { product_id, ...fields } = body

  try {
    if (!(await storeOwnsProduct(req, sellerId, product_id))) {
      return forbidden(res)
    }
    const { attribute, previousSellerId } = await saveAttributeAsProductOwner(
      nurseryService(req),
      sellerId,
      product_id,
      fields
    )
    if (previousSellerId) {
      log.warn("nursery attribute row taken over by its product's owner", {
        product_id,
        seller_id: sellerId,
        previous_seller_id: previousSellerId,
      })
    }
    res.status(201).json({ attribute })
  } catch (error) {
    routeFailure(log, req, res, "Failed to save nursery attributes", error)
  }
}
