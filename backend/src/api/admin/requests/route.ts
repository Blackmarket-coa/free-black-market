import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/requests")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../modules/request"
import RequestModuleService from "../../../modules/request/service"
import { RequestStatus } from "../../../modules/request/models"
import { sanitizeInput } from "../../../shared/seller-approval-service"
import { REQUEST_TYPES } from "../../../modules/request/validators"
import { requireAdminId } from "../../../shared/auth-helpers"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createRequestSchema = z.object({
  type: z.string().min(1, "Request type is required"),
  data: z.record(z.string(), z.unknown()).default({}),
  requester_id: z.string().min(1, "Requester ID is required"),
  reviewer_note: z.string().optional(),
})

const listRequestsSchema = z.object({
  status: z.nativeEnum(RequestStatus).optional(),
  requester_id: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /admin/requests
// List all requests (admin view)
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = listRequestsSchema.parse(req.query)

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.requester_id) filters.requester_id = query.requester_id
    if (query.type) {
      // Include both canonical and legacy seller request aliases on the
      // admin seller requests screen to avoid hiding valid registrations.
      if (query.type === REQUEST_TYPES.SELLER) {
        filters.type = { $in: [REQUEST_TYPES.SELLER, REQUEST_TYPES.SELLER_CREATION] }
      } else {
        filters.type = query.type
      }
    }

    // Use listAndCountRequests to get both results and total count for proper pagination
    const [requests, totalCount] = await requestService.listAndCountRequests(filters, {
      skip: query.offset,
      take: query.limit,
      order: { created_at: "DESC" },
    })

    res.json({
      requests,
      count: totalCount,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    log.error("[GET /admin/requests] Error:", error.message)
    res.status(500).json({ message: "Failed to retrieve requests" })
  }
}

// ===========================================
// POST /admin/requests
// Create a request on behalf of a customer
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const body = createRequestSchema.parse(req.body)
    const adminId = requireAdminId(req, res)
    if (!adminId) {
      return
    }

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    // Sanitize the reviewer note to prevent XSS
    const sanitizedNote = sanitizeInput(body.reviewer_note)

    const request = await requestService.createRequest({
      type: body.type,
      data: body.data,
      requester_id: body.requester_id,
      reviewer_note: sanitizedNote || undefined,
    })

    // Get actor info for audit logging
    log.info(`[POST /admin/requests] Request ${request.id} created by admin ${adminId}. Type: ${body.type}`)

    res.status(201).json({
      request,
      message: "Request created successfully",
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    log.error("[POST /admin/requests] Error:", error.message)
    res.status(500).json({ message: "Failed to create request" })
  }
}
