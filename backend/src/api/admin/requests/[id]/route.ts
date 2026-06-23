import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/requests/[id]")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../../modules/request"
import RequestModuleService from "../../../../modules/request/service"
import { RequestStatus } from "../../../../modules/request/models"
import { isSellerRequestType } from "../../../../modules/request/validators"
import {
  getSellerApprovalService,
  sanitizeInput,
} from "../../../../shared/seller-approval-service"
import { requireAdminId } from "../../../../shared/auth-helpers"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const updateRequestSchema = z.object({
  status: z.nativeEnum(RequestStatus).optional(),
  provider_id: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
})

const reviewRequestSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  reviewer_note: z.string().optional(),
})

// ===========================================
// GET /admin/requests/:id
// Get a specific request
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
    const requests = await requestService.listRequests({ id })

    if (requests.length === 0) {
      res.status(404).json({ message: "Request not found" })
      return
    }

    res.json({ request: requests[0] })
  } catch (error) {
    log.error(`[GET /admin/requests/${id}] Error:`, error.message)
    res.status(500).json({ message: "Failed to retrieve request" })
  }
}

// ===========================================
// POST /admin/requests/:id
// Review a request (accept/reject) - called by admin panel
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    // Validate the review payload
    const { status, reviewer_note } = reviewRequestSchema.parse(req.body)

    // Get reviewer ID from authenticated user
    const reviewerId = requireAdminId(req, res)
    if (!reviewerId) {
      return
    }

    const approvalService = getSellerApprovalService(req.scope)

    // Handle REJECTION
    if (status === "rejected") {
      const result = await approvalService.rejectRequest({
        requestId: id,
        reviewerId,
        reason: reviewer_note,
      })

      res.json({
        message: "Request rejected",
        request: result,
      })
      return
    }

    // Handle ACCEPTANCE
    // First, check if this is a seller request
    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
    const requests = await requestService.listRequests({ id })

    if (requests.length === 0) {
      res.status(404).json({ message: "Request not found" })
      return
    }

    const request = requests[0]

    if (isSellerRequestType(request.type)) {
      // Seller request - use full approval workflow
      const result = await approvalService.approveSeller({
        requestId: id,
        reviewerId,
        reviewerNote: reviewer_note,
      })

      res.json({
        message: "Seller registration approved successfully",
        seller: result.seller,
        request: result.request,
      })
    } else {
      // Generic request - just mark as accepted
      const result = await approvalService.approveGenericRequest({
        requestId: id,
        reviewerId,
        reviewerNote: reviewer_note,
      })

      res.json({
        message: "Request approved successfully",
        request: result,
      })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }

    // Handle specific error types
    if (error.message === "Request not found") {
      res.status(404).json({ message: error.message })
      return
    }

    if (error.message?.includes("already been")) {
      res.status(400).json({ message: error.message })
      return
    }

    log.error(`[POST /admin/requests/${id}] Error:`, error.message)
    res.status(500).json({
      message: error.message || "Failed to review request",
    })
  }
}

// ===========================================
// PATCH /admin/requests/:id
// Update a request (admin action)
// ===========================================

export async function PATCH(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const data = updateRequestSchema.parse(req.body)
    const adminId = requireAdminId(req, res)
    if (!adminId) {
      return
    }

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
    const requests = await requestService.listRequests({ id })

    if (requests.length === 0) {
      res.status(404).json({ message: "Request not found" })
      return
    }

    const updateData: Record<string, unknown> = {}

    if (data.status) updateData.status = data.status
    if (data.provider_id !== undefined) updateData.provider_id = data.provider_id
    if (data.payload) updateData.payload = data.payload
    if (data.notes !== undefined) updateData.notes = sanitizeInput(data.notes)

    const updated = await requestService.updateRequests({ id, ...updateData })

    res.json({
      request: updated,
      message: "Request updated successfully",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    log.error(`[PATCH /admin/requests/${id}] Error:`, error.message)
    res.status(500).json({ message: "Failed to update request" })
  }
}

// ===========================================
// DELETE /admin/requests/:id
// Delete a request (admin only, with audit logging)
// ===========================================

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
    const requests = await requestService.listRequests({ id })

    if (requests.length === 0) {
      res.status(404).json({ message: "Request not found" })
      return
    }

    const request = requests[0]

    // Get actor info for audit logging
    const actorId = requireAdminId(req, res)
    if (!actorId) {
      return
    }

    // Prevent deletion of non-pending requests without explicit override
    if (request.status !== RequestStatus.PENDING && request.status !== RequestStatus.REJECTED) {
      res.status(400).json({
        message: `Cannot delete request with status "${request.status}". Only pending or rejected requests can be deleted.`,
      })
      return
    }

    // Audit log the deletion
    log.info(`[DELETE /admin/requests/${id}] Request deleted by admin ${actorId}. Type: ${request.type}, Status: ${request.status}`)

    await requestService.deleteRequests(id)

    res.json({
      message: "Request deleted successfully",
      deleted: { id, type: request.type, status: request.status },
    })
  } catch (error) {
    log.error(`[DELETE /admin/requests/${id}] Error:`, error.message)
    res.status(500).json({ message: "Failed to delete request" })
  }
}
