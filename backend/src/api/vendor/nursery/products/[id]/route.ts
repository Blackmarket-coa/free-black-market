import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { definedFields } from "../../../../../shared/defined-fields"
import { parseRouteInput, routeFailure } from "../../../../../shared/route-input"
import { getSellerId } from "../../../quests/_helpers"
import { asAttributeUpdate, attributePath, nurseryService, ownedAttribute, updateAttributeBody } from "../../_access"

const log = createLogger("api/vendor/nursery/products/[id]")

/**
 * PUT /vendor/nursery/products/:id — update one of the store's attribute rows.
 *
 * The row must be the store's (its id or a member's) and on one of its
 * products (`ownedAttribute`);
 * any other, missing included, is `forbidden()`. Only the attribute columns
 * are written: the body used to be spread into the update, `metadata` and the
 * timestamps included.
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const path = parseRouteInput(res, req.params, attributePath)
  if (!path) return
  const fields = parseRouteInput(res, req.body, updateAttributeBody)
  if (!fields) return

  try {
    const row = await ownedAttribute(req, res, sellerId, path.id)
    if (!row) return
    const service = nurseryService(req)
    // A row still held under one of the store's member ids moves to the store.
    await service.updateNurseryProductAttributes(
      asAttributeUpdate({ ...definedFields(fields), id: row.id, seller_id: sellerId })
    )
    const attribute = await service.retrieveNurseryProductAttribute(row.id)
    res.json({ attribute })
  } catch (error) {
    routeFailure(log, req, res, "Failed to update nursery attributes", error)
  }
}

/** DELETE /vendor/nursery/products/:id — remove one of the store's attribute rows. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = await getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const path = parseRouteInput(res, req.params, attributePath)
  if (!path) return

  try {
    const row = await ownedAttribute(req, res, sellerId, path.id)
    if (!row) return
    await nurseryService(req).deleteNurseryProductAttributes(row.id)
    res.json({ id: row.id, deleted: true })
  } catch (error) {
    routeFailure(log, req, res, "Failed to delete nursery attributes", error)
  }
}
