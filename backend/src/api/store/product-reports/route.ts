import { z } from "zod"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REQUEST_MODULE } from "../../../modules/request"
import type RequestModuleService from "../../../modules/request/service"
import { ANONYMOUS_SUBMITTER_ID } from "../../../modules/request/validators"
import { createLogger } from "../../../shared/logger"

const log = createLogger("api/store/product-reports")

/**
 * Intake for a listing report.
 *
 * This exists because `ReportListingForm` had no backend at all: its submit
 * handler logged the form data to the browser console and then rendered "We'll
 * check the listing ... and take the necessary action". The report never left
 * the page. That is worse than having no form — it manufactures a record of
 * notice in the reporter's mind while destroying the notice itself, and the
 * one reason the form offers is "Trademark, Copyright or DMCA Violation".
 *
 * Deliberately NOT the bug-report handler's shape. That one opens a public
 * GitHub issue, which is an unacceptable destination for a rights-holder's
 * name, contact details and infringement claim.
 *
 * Deliberately NOT `POST /store/requests` either: that route requires an
 * authenticated customer (`requireCustomerId`), and a DMCA notice routinely
 * comes from a rights-holder who has never bought anything here. Reports are
 * accepted without a session; a customer id is recorded when one happens to be
 * present.
 *
 * The sink is the `request` module — the same generic approval primitive that
 * already backs seller registration, so a report lands in a queue admins
 * already work rather than inventing a second one.
 */

export const REPORT_REQUEST_TYPE = "listing_report"

const REPORT_REASONS = [
  "trademark_copyright_dmca",
  "prohibited_item",
  "counterfeit",
  "misleading_listing",
  "other",
] as const

const BodySchema = z
  .object({
    product_id: z.string().trim().min(1).max(120),
    reason: z.enum(REPORT_REASONS),
    comment: z.string().trim().min(10).max(4000),
    /** How to reach the reporter. Required for a DMCA notice to be actionable. */
    reporter_email: z.string().trim().email().max(320).optional(),
  })
  .strict()

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid report",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  // The product must exist, as the seller route requires of its seller. The
  // route is open to anonymous callers (a DMCA notice needs no account), so
  // without this anyone could file reports into the admin queue against any
  // string. Unknown ids get 404 and nothing is stored.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { id: parsed.data.product_id },
  })
  const product = (products as { id: string; handle?: string | null }[] | undefined)?.[0]
  if (!product) {
    return res.status(404).json({ message: "Product not found", type: "not_found" })
  }

  const customerId =
    (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context
      ?.actor_id || undefined

  const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

  const request = await requestService.createRequest({
    type: REPORT_REQUEST_TYPE,
    data: {
      product_id: product.id,
      product_handle: product.handle ?? null,
      reason: parsed.data.reason,
      comment: parsed.data.comment,
      reporter_email: parsed.data.reporter_email ?? null,
      source: "storefront",
    },
    // `request.submitter_id` is NOT NULL and `createRequest` throws when given
    // neither id. Passing only `requester_id` made every report from a visitor
    // with no session a 500, and the storefront form sends no credentials, so
    // no listing report was ever filed. The unit spec stubbed `createRequest`
    // and could not see it.
    submitter_id: customerId ?? ANONYMOUS_SUBMITTER_ID,
    requester_id: customerId,
  })

  // Deliberately no reporter detail in the log line: the report body can carry
  // a complainant's identity, and this is the defect's own failure mode in
  // miniature — the original handler's entire implementation was a log call.
  log.info(
    `listing report ${request.id} filed against product ${parsed.data.product_id} (${parsed.data.reason})`
  )

  return res.status(201).json({ id: request.id, status: request.status })
}
