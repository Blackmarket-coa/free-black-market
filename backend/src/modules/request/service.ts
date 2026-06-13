import { createLogger } from "../../shared/logger"
const log = createLogger("modules/request/service")
import { MedusaService } from "@medusajs/framework/utils"
import Request, { RequestStatus } from "./models/request"

/**
 * Valid status transitions for requests
 */
const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.PENDING]: [
    RequestStatus.ACCEPTED,
    RequestStatus.REJECTED,
    RequestStatus.CANCELLED,
  ],
  [RequestStatus.ACCEPTED]: [RequestStatus.COMPLETED],
  [RequestStatus.REJECTED]: [RequestStatus.ACCEPTED],
  [RequestStatus.COMPLETED]: [], // Terminal state
  [RequestStatus.CANCELLED]: [], // Terminal state
}

/**
 * RequestModuleService
 *
 * Provides CRUD operations for the Request module.
 * Extends MedusaService which provides:
 * - createRequests(data)
 * - listRequests(filters, config)
 * - listAndCountRequests(filters, config)
 * - updateRequests(selector, data)
 * - deleteRequests(ids)
 * - retrieveRequest(id, config)
 */
class RequestModuleService extends MedusaService({
  Request,
}) {
  /**
   * Create a single request (convenience wrapper)
   */
  async createRequest(input: {
    type: string
    data: Record<string, unknown>
    submitter_id?: string
    requester_id?: string
    reviewer_note?: string
  }) {
    // Support both submitter_id and requester_id for backwards compatibility
    const submitterId = input.submitter_id || input.requester_id

    if (!submitterId) {
      throw new Error("submitter_id or requester_id is required")
    }

    const [request] = await this.createRequests([{
      type: input.type,
      data: input.data,
      submitter_id: submitterId,
      requester_id: input.requester_id,
      reviewer_note: input.reviewer_note,
      status: RequestStatus.PENDING,
    }])

    return request
  }

  /**
   * Validate that a status transition is allowed
   * @throws Error if transition is not valid
   */
  private validateStatusTransition(
    currentStatus: RequestStatus,
    newStatus: RequestStatus
  ): void {
    const validTargets = VALID_TRANSITIONS[currentStatus] || []
    if (!validTargets.includes(newStatus)) {
      throw new Error(
        `Cannot transition request from "${currentStatus}" to "${newStatus}". ` +
        `Valid transitions from "${currentStatus}": ${validTargets.length > 0 ? validTargets.join(", ") : "none (terminal state)"}`
      )
    }
  }

  /**
   * Get a request by ID with status validation
   * @throws Error if request not found
   */
  private async getRequestForStatusChange(id: string) {
    const requests = await this.listRequests({ id })
    if (requests.length === 0) {
      throw new Error(`Request with ID "${id}" not found`)
    }
    return requests[0]
  }

  /**
   * Accept a request (update status to ACCEPTED)
   * Only allowed from PENDING status
   * @throws Error if request not found or not in PENDING status
   */
  async acceptRequest(id: string) {
    const existingRequest = await this.getRequestForStatusChange(id)
    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.ACCEPTED
    )

    const request = await this.updateRequests({
      id,
      status: RequestStatus.ACCEPTED,
    })
    return request
  }

  /**
   * Reject a request (update status to REJECTED)
   * Only allowed from PENDING status
   * @throws Error if request not found or not in PENDING status
   */
  async rejectRequest(id: string) {
    const existingRequest = await this.getRequestForStatusChange(id)
    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.REJECTED
    )

    const request = await this.updateRequests({
      id,
      status: RequestStatus.REJECTED,
    })
    return request
  }

  /**
   * Cancel a request (update status to CANCELLED)
   * Only allowed from PENDING status
   * @throws Error if request not found or not in PENDING status
   */
  async cancelRequest(id: string) {
    const existingRequest = await this.getRequestForStatusChange(id)
    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.CANCELLED
    )

    const request = await this.updateRequests({
      id,
      status: RequestStatus.CANCELLED,
    })
    return request
  }

  /**
   * Complete a request (update status to COMPLETED)
   * Only allowed from ACCEPTED status
   * @throws Error if request not found or not in ACCEPTED status
   */
  async completeRequest(id: string) {
    const existingRequest = await this.getRequestForStatusChange(id)
    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.COMPLETED
    )

    const request = await this.updateRequests({
      id,
      status: RequestStatus.COMPLETED,
    })
    return request
  }

  /**
   * Get requests by requester/submitter ID with pagination
   */
  async getRequesterRequests(
    requesterId: string,
    options?: { skip?: number; take?: number }
  ) {
    const requests = await this.listRequests(
      { submitter_id: requesterId },
      {
        skip: options?.skip,
        take: options?.take,
        order: { created_at: "DESC" },
      }
    )
    return requests
  }

  /**
   * Get requests by status with pagination
   */
  async getRequestsByStatus(
    status: RequestStatus,
    options?: { skip?: number; take?: number }
  ) {
    const requests = await this.listRequests(
      { status },
      {
        skip: options?.skip,
        take: options?.take,
        order: { created_at: "DESC" },
      }
    )
    return requests
  }

  /**
   * Check if a request can be transitioned to a given status
   */
  canTransitionTo(currentStatus: RequestStatus, targetStatus: RequestStatus): boolean {
    const validTargets = VALID_TRANSITIONS[currentStatus] || []
    return validTargets.includes(targetStatus)
  }

  /**
   * Check if a status is terminal (no further transitions allowed)
   */
  isTerminalStatus(status: RequestStatus): boolean {
    const validTargets = VALID_TRANSITIONS[status] || []
    return validTargets.length === 0
  }

  /**
   * Accept a request with reviewer info (full update)
   * This method updates status, reviewer_id, and reviewer_note in a single operation
   * @throws Error if request not found or not in PENDING status
   */
  async acceptRequestWithReview(
    id: string,
    reviewerId: string,
    reviewerNote?: string
  ) {
    log.info(`[RequestService] acceptRequestWithReview called for id: ${id}`)

    const existingRequest = await this.getRequestForStatusChange(id)
    log.info(`[RequestService] Found request with status: ${existingRequest.status}`)

    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.ACCEPTED
    )
    log.info(`[RequestService] Status transition validated`)

    // Build update data
    const updateData: Record<string, unknown> = {
      status: RequestStatus.ACCEPTED,
      reviewer_id: reviewerId,
    }

    if (reviewerNote) {
      updateData.reviewer_note = reviewerNote
    }

    log.info(`[RequestService] Updating request with data:`, JSON.stringify(updateData))

    // Use retrieveRequest + update pattern for more reliable single-record update
    try {
      await this.updateRequests({
        id,
        ...updateData,
      })

      const [updatedRequest] = await this.listRequests({ id })
      if (!updatedRequest) {
        throw new Error("Updated request could not be retrieved")
      }

      if (updatedRequest.status !== RequestStatus.ACCEPTED) {
        throw new Error("Request status update did not persist")
      }

      log.info(`[RequestService] Request updated successfully, new status: ${updatedRequest.status}`)
      return updatedRequest
    } catch (error: any) {
      log.error(`[RequestService] Failed to update request:`, error.message)
      log.error(`[RequestService] Error stack:`, error.stack)
      throw error
    }
  }

  /**
   * Reject a request with reviewer info (full update)
   * This method updates status, reviewer_id, and reviewer_note in a single operation
   * @throws Error if request not found or not in PENDING status
   */
  async rejectRequestWithReview(
    id: string,
    reviewerId: string,
    reason?: string
  ) {
    log.info(`[RequestService] rejectRequestWithReview called for id: ${id}`)

    const existingRequest = await this.getRequestForStatusChange(id)

    this.validateStatusTransition(
      existingRequest.status as RequestStatus,
      RequestStatus.REJECTED
    )

    // Build reviewer note
    let reviewerNote = existingRequest.reviewer_note || ""
    if (reason) {
      reviewerNote = `${reviewerNote}\n\nRejection reason: ${reason}`.trim()
    }

    const updateData: Record<string, unknown> = {
      status: RequestStatus.REJECTED,
      reviewer_id: reviewerId,
    }

    if (reviewerNote) {
      updateData.reviewer_note = reviewerNote
    }

    await this.updateRequests({
      id,
      ...updateData,
    })

    const [updatedRequest] = await this.listRequests({ id })
    if (!updatedRequest) {
      throw new Error("Updated request could not be retrieved")
    }

    if (updatedRequest.status !== RequestStatus.REJECTED) {
      throw new Error("Request status update did not persist")
    }

    log.info(`[RequestService] Request rejected successfully`)
    return updatedRequest
  }
}

export default RequestModuleService
