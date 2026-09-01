import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/v1/seller/push-tokens")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SellerAuthRequest } from "../../../middlewares/seller-context-v1"
import { NATIVE_PUSH_MODULE } from "../../../../modules/native-push"
import type NativePushModuleService from "../../../../modules/native-push/service"

/**
 * Seller device push-token registration for the in-app vendor surface.
 *
 * Lives on `/v1/seller/**` rather than `/store/*` or `/vendor/*` for two
 * concrete reasons:
 *   - `/store/*` structurally cannot authenticate a seller: Medusa's
 *     ApiLoader pins the store namespace to actor_type "customer", so a
 *     seller bearer yields no auth context there.
 *   - `/vendor/*` is fronted by the MercurJS plugin's own CORS, which does
 *     not include the storefront origin.
 * `/v1/seller/**` already carries `authenticate("seller","bearer")` plus
 * `requireSellerContextV1` (see src/api/middlewares.ts), so `req.seller_id`
 * is a resolved, canonical `sel_*` id by the time a handler runs.
 *
 * The seller id is ALWAYS taken from the authenticated context, never from
 * the request body — accepting it as input would let any caller subscribe
 * to a competitor's order notifications.
 */

const registerSchema = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(["ios", "android"]),
})

// Token is optional: the client may not have one yet (FCM registration
// fires once at launch), and sign-out must still detach this seller's
// devices. Omitting it detaches all of them, scoped to the caller.
const unregisterSchema = z.object({
  token: z.string().min(16).max(4096).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "token (min 16 chars) and platform (ios|android) are required",
    })
  }

  const nativePush = req.scope.resolve<NativePushModuleService>(
    NATIVE_PUSH_MODULE
  )

  try {
    const row = await nativePush.registerToken({
      token: parsed.data.token,
      platform: parsed.data.platform,
      seller_id: sellerId,
    })
    return res.status(200).json({ ok: true, id: row.id })
  } catch (error) {
    log.error("failed to register seller push token", error)
    return res
      .status(500)
      .json({ message: "Failed to register push token" })
  }
}

/**
 * Vendor sign-out: detach the seller from the device rather than deleting
 * the row. The same phone usually also holds a shopper session, and buyer
 * pushes must keep working after the vendor signs out.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res
      .status(401)
      .json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = unregisterSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "token, when supplied, must be a valid device token" })
  }

  const nativePush = req.scope.resolve<NativePushModuleService>(
    NATIVE_PUSH_MODULE
  )

  try {
    const detached = parsed.data.token
      ? await nativePush.detachSeller(parsed.data.token, sellerId)
      : (await nativePush.detachAllForSeller(sellerId)) > 0
    return res.status(200).json({ ok: true, detached })
  } catch (error) {
    log.error("failed to detach seller push token", error)
    return res.status(500).json({ message: "Failed to detach push token" })
  }
}
