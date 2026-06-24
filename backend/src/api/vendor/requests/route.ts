import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/requests")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../modules/request"
import RequestModuleService from "../../../modules/request/service"
import { RequestStatus } from "../../../modules/request/models"
import { requireSellerId } from "../../../shared/auth-helpers"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createRequestSchema = z.object({
  request: z.object({
    type: z.string().min(1, "Request type is required"),
    data: z.record(z.string(), z.unknown()).default({}),
  }),
})

const listRequestsSchema = z.object({
  status: z.nativeEnum(RequestStatus).optional(),
  type: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ===========================================
// GET /vendor/requests
// List vendor's requests
// ===========================================

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const query = listRequestsSchema.parse(req.query)

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    const filters: Record<string, unknown> = {
      submitter_id: sellerId,
    }
    if (query.status) filters.status = query.status
    if (query.type) filters.type = query.type

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
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    log.error("[GET /vendor/requests] Error:", error.message)
    res.status(500).json({ message: "Failed to retrieve requests" })
  }
}

// ===========================================
// POST /vendor/requests
// Create a new request (product type, collection, etc.)
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sellerId = await requireSellerId(req, res)
    if (!sellerId) return

    const body = createRequestSchema.parse(req.body)

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    const request = await requestService.createRequest({
      type: body.request.type,
      data: body.request.data,
      submitter_id: sellerId,
      requester_id: sellerId,
    })

    log.info(`[POST /vendor/requests] Request ${request.id} created by seller ${sellerId}. Type: ${body.request.type}`)

    res.status(201).json({
      request,
      message: "Request created successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    log.error("[POST /vendor/requests] Error:", error.message)
    res.status(500).json({ message: "Failed to create request" })
  }
}
