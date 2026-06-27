import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { VENDOR_RULES_MODULE } from "../../../../../modules/vendor-rules"
import type VendorRulesService from "../../../../../modules/vendor-rules/service"

/**
 * Plant Network — Wholesale application approval (Section 5).
 *
 * POST /admin/wholesale-application/:id/approve
 * Body: { seller_id, customer_id?, reviewed_by?, review_notes? }
 *
 * Creates/finds the buyer's customer account, adds them to the seller's existing
 * WHOLESALE VendorCustomerTier (no new pricing system), stamps the application
 * approved, and emails the approval. `seller_id` is the hub/coop seller whose
 * wholesale tier the buyer joins.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const applicationId = req.params.id
  const body = (req.body ?? {}) as {
    seller_id?: string
    customer_id?: string
    reviewed_by?: string
    review_notes?: string
  }

  const sellerId = body.seller_id || process.env.HUB_SELLER_ID
  if (!sellerId) {
    return res.status(400).json({
      message: "seller_id is required (the wholesale tier owner); set HUB_SELLER_ID or pass it in the body",
    })
  }

  const vendorRules = req.scope.resolve(VENDOR_RULES_MODULE) as unknown as VendorRulesService

  const [application] = await vendorRules.listWholesaleApplications({ id: applicationId })
  if (!application) {
    return res.status(404).json({ message: "Wholesale application not found" })
  }

  // Resolve or create the buyer's customer account.
  let customerId = body.customer_id ?? null
  const customerService = req.scope.resolve(Modules.CUSTOMER) as unknown as {
    listCustomers: (f: Record<string, unknown>) => Promise<Array<{ id: string }>>
    createCustomers: (
      d: Record<string, unknown>
    ) => Promise<{ id: string } | Array<{ id: string }>>
  }
  if (!customerId) {
    const existing = await customerService.listCustomers({ email: application.email })
    if (existing && existing.length > 0) {
      customerId = existing[0].id
    } else {
      const created = await customerService.createCustomers({
        email: application.email,
        first_name: application.contact_name,
        company_name: application.business_name,
      })
      customerId = Array.isArray(created) ? created[0].id : created.id
    }
  }

  const { application: approved, tier } = await vendorRules.approveWholesaleApplication({
    application_id: applicationId,
    seller_id: sellerId,
    customer_id: customerId!,
    reviewed_by: body.reviewed_by,
    review_notes: body.review_notes,
  })

  // Approval email (best-effort).
  try {
    const notification = req.scope.resolve(Modules.NOTIFICATION) as unknown as {
      createNotifications: (d: Record<string, unknown>) => Promise<unknown>
    }
    await notification.createNotifications({
      to: application.email,
      channel: "email",
      template: "wholesale-application-approved",
      data: {
        business_name: application.business_name,
        contact_name: application.contact_name,
        tier_name: tier.name,
        payment_terms_days: tier.payment_terms_days,
      },
    })
  } catch {
    // best-effort
  }

  return res.json({
    status: "approved",
    application: { id: approved.id, status: approved.status, customer_id: customerId },
    tier: { id: tier.id, name: tier.name },
  })
}
