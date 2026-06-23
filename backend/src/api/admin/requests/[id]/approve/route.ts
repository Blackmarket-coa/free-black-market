import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/admin/requests/[id]/approve")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REQUEST_MODULE } from "../../../../../modules/request"
import RequestModuleService from "../../../../../modules/request/service"
import { isSellerRequestType } from "../../../../../modules/request/validators"
import { getSellerApprovalService } from "../../../../../shared/seller-approval-service"
import { requireAdminId } from "../../../../../shared/auth-helpers"

/**
 * POST /admin/requests/:id/approve
 *
 * Approve a request. For seller creation requests, this will:
 * 1. Create the seller using MercurJS workflow
 * 2. Link auth identity to seller
 * 3. Create seller metadata
 * 4. Provision Matrix (Blackout) user + vendor room (if configured)
 * 5. Mark the request as accepted
 *
 * Uses the shared SellerApprovalService for consistent behavior.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    // Get reviewer ID from authenticated user
    const reviewerId = requireAdminId(req, res)
    if (!reviewerId) {
      return
    }

    const approvalService = getSellerApprovalService(req.scope)

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
      })

      res.json({
        message: "Request approved successfully",
        request: result,
      })
    }
  } catch (error) {
    // Handle specific error types
    if (error.message === "Request not found") {
      res.status(404).json({ message: error.message })
      return
    }

    if (error.message?.includes("already been")) {
      res.status(400).json({ message: error.message })
      return
    }

    if (error.message?.includes("Invalid request data")) {
      res.status(400).json({ message: error.message })
      return
    }

    log.error(`[POST /admin/requests/${id}/approve] Error:`, error.message)
    res.status(500).json({
      message: error.message || "Failed to approve request",
    })
  }
}
