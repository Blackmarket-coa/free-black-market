import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../modules/request"
import RequestModuleService from "../../../modules/request/service"
import { requireCustomerId } from "../../../shared"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createRequestSchema = z.object({
  type: z.string().min(1, "Request type is required"),
  data: z.record(z.string(), z.unknown()).default({}),
  reviewer_note: z.string().optional(),
})

// ===========================================
// GET /store/requests
// Get customer's requests
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    const requests = await requestService.getRequesterRequests(customerId)

    res.json({
      requests,
      count: requests.length,
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /store/requests
// Create a new request (RFQ)
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const data = createRequestSchema.parse(req.body)

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)

    const request = await requestService.createRequest({
      type: data.type,
      data: data.data,
      requester_id: customerId,
      reviewer_note: data.reviewer_note,
    })

    res.status(201).json({
      request,
      message: "Request created successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
