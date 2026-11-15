import { z } from "zod"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REQUEST_MODULE } from "../../../modules/request"
import type RequestModuleService from "../../../modules/request/service"
import { ANONYMOUS_SUBMITTER_ID } from "../../../modules/request/validators"
import { createLogger } from "../../../shared/logger"

const log = createLogger("api/store/seller-reports")

/**
 * Intake for a report against a seller.
 *
 * `ReportSellerForm`, mounted in the footer of every seller page, had no
 * backend: its submit handler was `logger.info('Form Data:', data)` and the
 * view then told the reporter "We'll check ... and take the necessary action".
 * The only reason it offered was "Trademark, Copyright or DMCA Violation", so
 * the one thing the form existed to receive was the thing it threw away.
 *
 * Built like `POST /store/product-reports` and for the same reasons: a
 * rights-holder filing a notice has usually never bought anything here, so no
 * session is required (a customer id is recorded when the framework's optional
 * /store authentication resolved one), and the sink is the `request` module, so
 * a report lands in `GET /admin/requests?type=seller_report` rather than in a
 * second queue nobody works.
 *
 * It is a separate route rather than a looser product-reports schema because
 * that schema is `.strict()` and requires `product_id`; making it optional would
 * let a listing report arrive naming nothing.
 *
 * The seller must exist. A report naming no real seller is not actionable, and
 * filing it would put noise in front of the people who act on real ones.
 *
 * The reported seller cannot see the report: `GET /vendor/requests` lists rows
 * whose `submitter_id` is the seller, and a report's submitter is the reporter.
 */

export const SELLER_REPORT_REQUEST_TYPE = "seller_report"

export const SELLER_REPORT_REASONS = [
  "trademark_copyright_dmca",
  "counterfeit",
  "prohibited_items",
  "fraud_or_scam",
  "impersonation",
  "harassment",
  "other",
] as const

const BodySchema = z
  .object({
    seller_id: z.string().trim().min(1).max(120),
    reason: z.enum(SELLER_REPORT_REASONS),
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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "handle"],
    filters: { id: parsed.data.seller_id },
  })
  const seller = (sellers as { id: string; handle?: string | null }[] | undefined)?.[0]
  if (!seller) {
    return res.status(404).json({ message: "Seller not found", type: "not_found" })
  }

  const customerId =
    (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context
      ?.actor_id || undefined

  const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

  const request = await requestService.createRequest({
    type: SELLER_REPORT_REQUEST_TYPE,
    data: {
      seller_id: seller.id,
      seller_handle: seller.handle ?? null,
      reason: parsed.data.reason,
      comment: parsed.data.comment,
      reporter_email: parsed.data.reporter_email ?? null,
      source: "storefront",
    },
    // `request.submitter_id` is NOT NULL and `createRequest` refuses a request
    // with neither id, so an anonymous report needs an explicit submitter.
    submitter_id: customerId ?? ANONYMOUS_SUBMITTER_ID,
    requester_id: customerId,
  })

  // No reporter detail in the log line: the body can carry a complainant's
  // identity, and the original handler's entire implementation was a log call.
  log.info(
    `seller report ${request.id} filed against seller ${seller.id} (${parsed.data.reason})`
  )

  return res.status(201).json({ id: request.id, status: request.status })
}
