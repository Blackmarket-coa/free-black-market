import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/native/push-tokens")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NATIVE_PUSH_MODULE } from "../../../../modules/native-push"
import type NativePushModuleService from "../../../../modules/native-push/service"

/**
 * Device push-token registry for the FBM Capacitor shell.
 *
 * The storefront's NativeAppBridge registers the FCM token the shell
 * hands it (`fbm:push-token`) via the storefront server action, which
 * forwards the customer's auth cookie — so an authenticated registration
 * attaches the device to that customer. Anonymous registrations are kept
 * (token-only) and attach on the next authenticated refresh.
 *
 * DELETE detaches the CUSTOMER from a token (logout / permission
 * revoked). Possession of the token is the credential: FCM tokens are
 * unguessable, and the worst a spoofed delete can do is silence buyer
 * pushes to a device that will re-register on next launch.
 *
 * It deliberately does not delete the row. The same device may also be
 * attached to a seller for vendor order notifications, and this endpoint
 * is unauthenticated — retiring the row here would let anyone holding a
 * token permanently silence that vendor. The row is retired only when no
 * seller is attached either (see `detachCustomer`).
 */

const registerSchema = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(["ios", "android"]),
})

const unregisterSchema = z.object({
  token: z.string().min(16).max(4096),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "token (min 16 chars) and platform (ios|android) are required",
    })
  }

  const nativePush = req.scope.resolve<NativePushModuleService>(
    NATIVE_PUSH_MODULE
  )
  // Populated by Medusa for /store when a customer session/bearer token is
  // present; absent for anonymous callers. Same handler-level read as the
  // other store surfaces.
  const authContext = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  const customerId =
    authContext?.actor_type === "customer" ? authContext.actor_id ?? null : null

  try {
    const row = await nativePush.registerToken({
      token: parsed.data.token,
      platform: parsed.data.platform,
      customer_id: customerId,
    })
    return res.status(200).json({
      ok: true,
      id: row.id,
      attached_to_customer: Boolean(customerId),
    })
  } catch (error) {
    log.error("failed to register push token", error)
    return res.status(500).json({ message: "Failed to register push token" })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const parsed = unregisterSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: "token is required" })
  }

  const nativePush = req.scope.resolve<NativePushModuleService>(
    NATIVE_PUSH_MODULE
  )

  try {
    const removed = await nativePush.detachCustomer(parsed.data.token)
    return res.status(200).json({ ok: true, removed })
  } catch (error) {
    log.error("failed to unregister push token", error)
    return res.status(500).json({ message: "Failed to unregister push token" })
  }
}
