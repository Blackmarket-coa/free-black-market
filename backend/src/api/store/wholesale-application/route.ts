import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VENDOR_RULES_MODULE } from "../../../modules/vendor-rules"
import type VendorRulesService from "../../../modules/vendor-rules/service"
import { WholesaleBuyerType } from "../../../modules/vendor-rules/models/wholesale-application"
import { emitBlackoutEvent } from "../../../lib/blackout-emit"
import { Modules } from "@medusajs/framework/utils"

/**
 * Plant Network — Wholesale account application intake (Section 5).
 *
 * Persists the application (vendor-rules module), notifies the Hub (Blackout +
 * email) and confirms to the applicant. Approval → assignment into the existing
 * WHOLESALE VendorCustomerTier happens at
 * `api/admin/wholesale-application/[id]/approve`.
 */

export interface WholesaleApplicationPayload {
  business_name: string
  contact_name: string
  email: string
  phone: string
  state: string
  nursery_license_number?: string
  estimated_annual_volume_usd: number
  species_interests: string[]
  buyer_type: WholesaleBuyerType
}

const REQUIRED: (keyof WholesaleApplicationPayload)[] = [
  "business_name",
  "contact_name",
  "email",
  "phone",
  "state",
]

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Partial<WholesaleApplicationPayload>

  const missing = REQUIRED.filter((k) => !body[k] || String(body[k]).trim() === "")
  if (missing.length > 0) {
    return res.status(400).json({ message: `Missing required fields: ${missing.join(", ")}` })
  }
  if (!/.+@.+\..+/.test(String(body.email))) {
    return res.status(400).json({ message: "Invalid email" })
  }

  const validBuyerTypes = Object.values(WholesaleBuyerType) as string[]
  const buyerType =
    body.buyer_type && validBuyerTypes.includes(body.buyer_type)
      ? body.buyer_type
      : WholesaleBuyerType.OTHER

  const vendorRules = req.scope.resolve(VENDOR_RULES_MODULE) as unknown as VendorRulesService

  const application = await vendorRules.createWholesaleApplication({
    business_name: String(body.business_name),
    contact_name: String(body.contact_name),
    email: String(body.email),
    phone: String(body.phone),
    state: String(body.state).toUpperCase(),
    nursery_license_number: body.nursery_license_number ?? null,
    estimated_annual_volume_usd: Number(body.estimated_annual_volume_usd ?? 0),
    species_interests: Array.isArray(body.species_interests) ? body.species_interests : [],
    buyer_type: buyerType,
  })

  // Notify the Hub (best-effort) + confirm to the applicant.
  try {
    await emitBlackoutEvent(
      req.scope,
      "wholesale_application.received",
      {
        applicationId: application.id,
        businessName: application.business_name,
        state: application.state,
        buyerType,
      },
      { eventId: `wholesale_application.received:${application.id}` }
    )
    const notification = req.scope.resolve(Modules.NOTIFICATION) as any
    await notification.createNotifications({
      to: application.email,
      channel: "email",
      template: "wholesale-application-received",
      data: { business_name: application.business_name, contact_name: application.contact_name },
    })
  } catch {
    // notifications are best-effort; the application is already persisted
  }

  return res.status(201).json({
    status: "received",
    application_id: application.id,
    estimated_review_hours: 48,
  })
}
