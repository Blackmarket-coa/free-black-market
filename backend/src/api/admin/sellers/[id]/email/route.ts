import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ResendService } from "../../../../../services/apprise/resend.service"
import { requireAdminId } from "../../../../../shared/auth-helpers"

type RouteParams = {
  id: string
}

type SendVendorEmailBody = {
  subject?: string
  message?: string
}

/**
 * POST /admin/sellers/:id/email
 * Send an email to a seller/vendor from the admin panel.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<SendVendorEmailBody, RouteParams>,
  res: MedusaResponse
) => {
  const adminId = requireAdminId(req, res)
  if (!adminId) {
    return
  }

  const { id } = req.params
  const { subject, message } = req.body || {}

  if (!subject?.trim() || !message?.trim()) {
    return res.status(400).json({
      message: "subject and message are required",
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "name", "email"],
    filters: { id },
  })

  const seller = sellers?.[0]

  if (!seller) {
    return res.status(404).json({ message: "Seller not found" })
  }

  if (!seller.email) {
    return res.status(400).json({ message: "Seller has no email address" })
  }

  const resendService = new ResendService({
    apiKey: process.env.RESEND_API_KEY || "",
    fromEmail: process.env.RESEND_FROM_EMAIL,
    fromName: process.env.RESEND_FROM_NAME || "Ground Up Liberation Admin",
  })

  const result = await resendService.sendEmail({
    to: seller.email,
    subject: subject.trim(),
    text: message.trim(),
    html: `<p>${message
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />")}</p>`,
    tags: [
      { name: "channel", value: "admin" },
      { name: "entity", value: "seller" },
      { name: "seller_id", value: seller.id },
      { name: "admin_id", value: adminId },
    ],
  })

  if (!result.success) {
    return res.status(500).json({
      message: result.error || "Failed to send email",
    })
  }

  return res.status(200).json({
    success: true,
    id: result.id,
    seller_id: seller.id,
    email: seller.email,
  })
}
