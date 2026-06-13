import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/sellers/invite")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/framework/types"
import { appendPath } from "../../../../shared/url"

/**
 * POST /admin/sellers/invite
 *
 * Invite a seller by email
 */
export const POST = async (
  req: MedusaRequest<{
    email: string
    registration_url?: string
  }>,
  res: MedusaResponse
) => {
  const { email, registration_url } = req.body

  if (!email) {
    return res.status(400).json({
      message: "Email is required",
    })
  }

  try {
    const notificationModule: INotificationModuleService = req.scope.resolve(
      Modules.NOTIFICATION
    )

    // Send invitation email
    const fallbackBaseUrl =
      process.env.VENDOR_PANEL_URL || req.headers.origin || ""
    const resolvedRegistrationUrl =
      registration_url ||
      (fallbackBaseUrl
        ? appendPath(fallbackBaseUrl, "/vendor/register")
        : "")

    await notificationModule.createNotifications({
      to: email,
      channel: "email",
      template: "seller-invitation",
      data: {
        registration_url: resolvedRegistrationUrl,
        email,
      },
    })

    return res.json({
      message: "Invitation sent successfully",
      email,
    })
  } catch (error) {
    log.error("Failed to send seller invitation:", error)
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Failed to send invitation",
    })
  }
}
