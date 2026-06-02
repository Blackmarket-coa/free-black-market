import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RequestStatus } from "../../../../../modules/request/models"
import { getSellerApprovalService } from "../../../../../shared/seller-approval-service"
import { requireAdminId } from "../../../../../shared/auth-helpers"

const rejectSchema = z.object({
  reason: z.string().optional(),
})

/**
 * POST /admin/requests/:id/reject
 *
 * Reject a request with an optional reason.
 * Uses the shared SellerApprovalService for consistent behavior.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { reason } = rejectSchema.parse(req.body || {})

    // Get reviewer ID from authenticated user
    const reviewerId = requireAdminId(req, res)
    if (!reviewerId) {
      return
    }

    const approvalService = getSellerApprovalService(req.scope)

    const result = await approvalService.rejectRequest({
      requestId: id,
      reviewerId,
      reason,
    })

    res.json({
      message: "Request rejected",
      request: {
        id: result.id,
        status: RequestStatus.REJECTED,
        reason,
      },
    })
  } catch (error: any) {
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

    console.error(`[POST /admin/requests/${id}/reject] Error:`, error.message)
    res.status(500).json({
      message: error.message || "Failed to reject request",
    })
  }
}
