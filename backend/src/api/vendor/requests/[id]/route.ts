import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../../modules/request"
import type RequestModuleService from "../../../../modules/request/service"
import { RequestStatus } from "../../../../modules/request/models"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { forbidden } from "../../../../shared/community-read-access"
import { nullIfNotFound } from "../../../../shared/null-if-not-found"
import { createLogger } from "../../../../shared/logger"

const log = createLogger("api/vendor/requests/[id]")

/**
 * A seller's own request, read and edited.
 *
 * The vendor panel's request detail, category edit, collection edit and
 * review-report screens call `GET` and `POST /vendor/requests/:id`
 * (vendor-panel/src/hooks/api/requests.tsx), and nothing served either, so
 * each of those screens failed on load or on save.
 *
 * Scope: only requests this seller submitted (`submitter_id`), the same scope
 * as the list. A request that does not exist and one that belongs to someone
 * else get the same 403 (`forbidden`), so the answer says nothing about which
 * ids exist.
 */

type RequestRow = {
  id: string
  type: string
  status: string
  submitter_id: string
  data: Record<string, unknown> | null
}

async function ownRequest(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<{ service: RequestModuleService; request: RequestRow } | null> {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return null
  const service = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
  const request = (await nullIfNotFound(service.retrieveRequest(req.params.id))) as RequestRow | null
  if (!request || request.submitter_id !== sellerId) {
    forbidden(res)
    return null
  }
  return { service, request }
}

// GET /vendor/requests/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const found = await ownRequest(req, res)
  if (!found) return
  res.json({ request: found.request })
}

const updateRequestSchema = z.object({
  request: z.object({
    type: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
})

/**
 * POST /vendor/requests/:id — merge an edit into the data of the seller's own
 * request.
 *
 * It merges; it does not replace. `updateRequests` goes through Medusa's
 * MikroORM repository, which assigns with `mergeObjectProperties: true`, so
 * the keys sent overwrite the stored ones, nested objects merge, arrays and
 * scalars are replaced, and keys left out are kept: a key cannot be removed,
 * only set to null. That is what the panel relies on: the category edit form
 * sends only `{ name, handle }`, and replacement would erase the description,
 * is_active, is_internal and parent_category_id the create form stored.
 * (`integration-tests/http/vendor-request-detail.spec.ts` pins it.)
 *
 * Only while it is pending: once an admin has accepted, rejected or completed
 * it, or it was cancelled, the record of what was decided must not change
 * under the decision (409). The type cannot change (400): a request is
 * reviewed as the kind it was filed as, and the panel always sends the same
 * type back.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = updateRequestSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues })
  }

  const found = await ownRequest(req, res)
  if (!found) return
  const { service, request } = found

  if (parsed.data.request.type !== request.type) {
    return res.status(400).json({
      message: `This request is a ${request.type} request; its type cannot be changed`,
      type: "invalid_data",
    })
  }
  if (request.status !== RequestStatus.PENDING) {
    return res.status(409).json({
      message: `This request is ${request.status} and can no longer be edited`,
      type: "not_allowed",
    })
  }

  const updated = await service.updateRequests({ id: request.id, data: parsed.data.request.data })
  log.info(`[POST /vendor/requests/:id] request ${request.id} (${request.type}) edited by its submitter`)
  res.json({ request: updated })
}
