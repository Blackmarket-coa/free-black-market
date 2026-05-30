import { MedusaContainer } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { createSellerMetadataWorkflow } from "../workflows/create-seller-metadata"
import { sendVendorAcceptedNotificationWorkflow } from "../workflows/send-vendor-accepted-notification"
import { appendPath } from "./url"
import { sendCustomerAcceptedNotificationWorkflow } from "../workflows/send-customer-accepted-notification"
import { VendorType } from "../modules/seller-extension/models/seller-metadata"
import { getMatrixService, GOVERNANCE_POWER_LEVEL } from "./matrix-service"
import { REQUEST_MODULE } from "../modules/request"
import RequestModuleService from "../modules/request/service"
import { RequestStatus } from "../modules/request/models"
import { REQUEST_TYPES, isSellerRequestType } from "../modules/request/validators"

/**
 * Result of a successful seller approval
 */
export interface SellerApprovalResult {
  seller: {
    id: string
    name: string
    handle?: string
  }
  request: {
    id: string
    status: RequestStatus
  }
  matrixCreated: boolean
}

/**
 * Input for seller approval
 */
export interface SellerApprovalInput {
  requestId: string
  reviewerId: string
  reviewerNote?: string
}

/**
 * Input for request rejection
 */
export interface RequestRejectionInput {
  requestId: string
  reviewerId: string
  reason?: string
}

/**
 * Seller request data structure
 */
interface SellerRequestData {
  auth_identity_id: string
  member: {
    name: string
    email: string
  }
  seller: {
    name: string
  }
  vendor_type?: string
}

/**
 * Masks an email address for logging purposes
 * Example: john.doe@example.com -> j***e@example.com
 */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@")
  if (!domain || localPart.length < 2) {
    return "***@***"
  }
  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`
}

/**
 * Masks a name for logging purposes
 * Example: John Doe -> J*** D***
 */
export function maskName(name: string): string {
  return name
    .split(" ")
    .map((part) => (part.length > 0 ? `${part[0]}***` : ""))
    .join(" ")
}

/**
 * Validates seller request data structure
 */
function validateSellerRequestData(data: unknown): SellerRequestData {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid request data: expected object")
  }

  const d = data as Record<string, unknown>

  // Validate auth_identity_id
  if (typeof d.auth_identity_id !== "string" || !d.auth_identity_id) {
    throw new Error("Invalid request data: missing or invalid auth_identity_id")
  }

  // Validate member
  if (!d.member || typeof d.member !== "object") {
    throw new Error("Invalid request data: missing member information")
  }
  const member = d.member as Record<string, unknown>
  if (typeof member.name !== "string" || !member.name) {
    throw new Error("Invalid request data: missing member name")
  }
  if (typeof member.email !== "string" || !member.email) {
    throw new Error("Invalid request data: missing member email")
  }

  // Validate seller
  if (!d.seller || typeof d.seller !== "object") {
    throw new Error("Invalid request data: missing seller information")
  }
  const seller = d.seller as Record<string, unknown>
  if (typeof seller.name !== "string" || !seller.name) {
    throw new Error("Invalid request data: missing seller name")
  }

  return {
    auth_identity_id: d.auth_identity_id,
    member: {
      name: member.name,
      email: member.email,
    },
    seller: {
      name: seller.name,
    },
    vendor_type: typeof d.vendor_type === "string" ? d.vendor_type : undefined,
  }
}

/**
 * Sanitizes input to prevent XSS and injection attacks
 * Removes HTML tags and trims whitespace
 */
export function sanitizeInput(input: string | undefined | null): string {
  if (!input) return ""
  // Remove HTML tags and trim
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim()
}

/**
 * SellerApprovalService
 *
 * Handles seller request approval with proper transaction handling.
 * Consolidates duplicate approval logic from multiple routes.
 */
export class SellerApprovalService {
  private container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private async resolveCustomerContact(request: {
    submitter_id?: string | null
    data?: Record<string, unknown>
  }): Promise<{ email: string; name?: string } | null> {
    if (request.submitter_id) {
      const query = this.container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: [customer] } = await query.graph({
        entity: "customer",
        fields: ["id", "email", "first_name", "last_name"],
        filters: {
          id: request.submitter_id,
        },
      })

      if (customer?.email) {
        const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(" ")
        return {
          email: customer.email,
          name: fullName || customer.email.split("@")[0],
        }
      }
    }

    const data = request.data
    if (!data) {
      return null
    }

    const directEmail = typeof data.email === "string" ? data.email : undefined
    const member = typeof data.member === "object" && data.member ? (data.member as Record<string, unknown>) : undefined
    const customer = typeof data.customer === "object" && data.customer ? (data.customer as Record<string, unknown>) : undefined

    const fallbackEmail = directEmail ||
      (typeof member?.email === "string" ? member.email : undefined) ||
      (typeof customer?.email === "string" ? customer.email : undefined)

    if (!fallbackEmail) {
      return null
    }

    const fallbackName = (typeof data.name === "string" ? data.name : undefined) ||
      (typeof member?.name === "string" ? member.name : undefined) ||
      (typeof customer?.name === "string" ? customer.name : undefined)

    return {
      email: fallbackEmail,
      name: fallbackName,
    }
  }

  /**
   * Approve a seller request and create the seller entity
   *
   * This method handles:
   * 1. Request validation
   * 2. Seller creation via workflow
   * 3. Auth identity linking
   * 4. Seller metadata creation
   * 5. Matrix (Blackout) user + room provisioning (non-blocking)
   * 6. Request status update
   *
   * If critical steps fail, compensating actions are taken.
   */
  async approveSeller(input: SellerApprovalInput): Promise<SellerApprovalResult> {
    const { requestId, reviewerId, reviewerNote } = input
    const requestService = this.container.resolve<RequestModuleService>(REQUEST_MODULE)

    // Step 1: Get and validate the request
    const requests = await requestService.listRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Request not found")
    }

    const request = requests[0]

    // Allow approving previously rejected requests to recover accidental rejections.
    if (request.status !== RequestStatus.PENDING && request.status !== RequestStatus.REJECTED) {
      throw new Error(`Request cannot be approved from status ${request.status}`)
    }

    // Validate request type
    if (!isSellerRequestType(request.type)) {
      throw new Error(`Invalid request type for seller approval: ${request.type}`)
    }

    // Step 2: Validate and extract request data
    let data: SellerRequestData
    try {
      data = validateSellerRequestData(request.data)
    } catch (validationError: any) {
      console.error(`[SellerApproval] Request data validation failed:`, validationError.message)
      console.error(`[SellerApproval] Request data was:`, JSON.stringify(request.data, null, 2))
      throw new Error(`Invalid request data: ${validationError.message}`)
    }
    const vendorType = data.vendor_type || "producer"

    console.log(`[SellerApproval] Processing approval for seller "${data.seller.name}" (email: ${maskEmail(data.member.email)})`)

    // Step 2.5: Verify auth identity exists before proceeding
    const authModule = this.container.resolve(Modules.AUTH)
    const authIdentities = await authModule.listAuthIdentities({ id: [data.auth_identity_id] })
    if (!authIdentities || authIdentities.length === 0) {
      console.error(`[SellerApproval] Auth identity not found: ${data.auth_identity_id}`)
      throw new Error(`Auth identity not found. The user may need to re-register.`)
    }
    console.log(`[SellerApproval] Auth identity verified: ${data.auth_identity_id}`)

    let createdSeller: { id: string; name: string; handle?: string } | null = null
    let authUpdated = false

    try {
      // Step 3: Create the seller using MercurJS workflow
      console.log(`[SellerApproval] Starting seller workflow with auth_identity_id: ${data.auth_identity_id}`)

      const workflowInput = {
        auth_identity_id: data.auth_identity_id,
        member: {
          name: data.member.name,
          email: data.member.email,
        },
        seller: {
          name: data.seller.name,
        },
      }
      console.log(`[SellerApproval] Workflow input:`, JSON.stringify(workflowInput, null, 2))

      let seller: { id: string; name: string; handle?: string }

      try {
        const workflowResult = await createSellerWorkflow.run({
          container: this.container,
          input: workflowInput,
        })

        const { result } = workflowResult
        if (!result || !result.id) {
          throw new Error("Seller creation workflow did not return a valid seller")
        }
        seller = result
        createdSeller = seller
        console.log(`[SellerApproval] Seller created with ID: ${seller.id}`)
      } catch (workflowError: any) {
        // Check if it's a duplicate handle error - if so, try to find and link existing seller
        if (workflowError.message?.includes("already exists")) {
          console.log(`[SellerApproval] Seller already exists, attempting to find and link existing seller...`)

          const query = this.container.resolve(ContainerRegistrationKeys.QUERY)
          const pgConnection = this.container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

          let existingSeller: { id: string; name: string; handle?: string } | undefined

          // First try to find by member email via direct lookup
          const memberResult = await pgConnection.raw(
            `
            SELECT seller_id
            FROM member
            WHERE email = ?
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [data.member.email]
          )
          const sellerId = memberResult.rows?.[0]?.seller_id
          if (sellerId) {
            const { data: sellers } = await query.graph({
              entity: "seller",
              fields: ["id", "name", "handle"],
              filters: { id: sellerId },
            })
            existingSeller = sellers?.[0]
          }

          // If not found by email, try to find by handle (derived from seller name)
          if (!existingSeller) {
            console.log(`[SellerApproval] Seller not found by email, trying by handle...`)

            // Generate expected handle from seller name (MercurJS uses kebab-case)
            const expectedHandle = data.seller.name
              .toLowerCase()
              .trim()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9-]/g, '')

            const handleResult = await pgConnection.raw(
              `
              SELECT id, name, handle
              FROM seller
              WHERE handle = ? OR handle LIKE ?
              ORDER BY length(handle) ASC
              LIMIT 1
              `,
              [expectedHandle, `${expectedHandle}%`]
            )
            const handleMatch = handleResult.rows?.[0]
            if (handleMatch) {
              existingSeller = {
                id: handleMatch.id,
                name: handleMatch.name,
                handle: handleMatch.handle,
              }
            }

            if (existingSeller) {
              console.log(`[SellerApproval] Found seller by handle: ${existingSeller.handle}`)
            }
          }

          if (existingSeller) {
            console.log(`[SellerApproval] Found existing seller: ${existingSeller.id} (${existingSeller.name})`)
            seller = { id: existingSeller.id, name: existingSeller.name, handle: existingSeller.handle }
            createdSeller = seller
          } else {
            console.error(`[SellerApproval] Could not find existing seller to link. Email: ${data.member.email}, Name: ${data.seller.name}`)
            throw new Error(`Seller creation workflow failed: ${workflowError.message}`)
          }
        } else {
          console.error(`[SellerApproval] Workflow execution failed:`, workflowError.message)
          console.error(`[SellerApproval] Workflow error details:`, workflowError)
          throw new Error(`Seller creation workflow failed: ${workflowError.message}`)
        }
      }

      // Step 4: Update auth_identity with seller_id (CRITICAL)
      const authModule = this.container.resolve(Modules.AUTH)
      await authModule.updateAuthIdentities([{
        id: data.auth_identity_id,
        app_metadata: {
          seller_id: seller.id,
        },
      }])
      authUpdated = true
      console.log(`[SellerApproval] Auth identity linked successfully`)

      // Step 5: Create seller metadata with vendor_type
      try {
        const vendorTypeEnum = VendorType[vendorType.toUpperCase() as keyof typeof VendorType] || VendorType.PRODUCER

        await createSellerMetadataWorkflow.run({
          container: this.container,
          input: {
            seller_id: seller.id,
            vendor_type: vendorTypeEnum,
          },
        })
        console.log(`[SellerApproval] Metadata created with vendor_type: ${vendorTypeEnum}`)
      } catch (metadataError: any) {
        // Non-critical: subscriber will create with default type
        console.warn(`[SellerApproval] Metadata creation failed (will use fallback): ${metadataError.message}`)
      }

      // Step 6: Provision Matrix (Blackout) user + vendor room (non-blocking)
      let matrixCreated = false
      const matrixService = getMatrixService()
      if (matrixService) {
        try {
          const localpartSource = seller.handle || data.member.email.split("@")[0]
          const { mxid } = await matrixService.ensureUser(
            localpartSource,
            data.member.name,
            { email: data.member.email }
          )

          const vendorAlias = `vendor-${seller.handle || seller.id}`
          await matrixService.ensureRoom({
            alias: vendorAlias,
            name: `${data.seller.name} Channel`,
            invite: [mxid],
            powerLevels: { [mxid]: GOVERNANCE_POWER_LEVEL.vendor },
          })

          await matrixService.invite(
            `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
            mxid
          )

          matrixCreated = true
          console.log(`[SellerApproval] Matrix account provisioned: ${mxid}`)
        } catch (matrixError: any) {
          console.warn(`[SellerApproval] Matrix provisioning failed (non-blocking): ${matrixError.message}`)
        }
      }

      // Step 7: Update request status and reviewer info using dedicated service method
      console.log(`[SellerApproval] Step 7: Updating request status to ACCEPTED...`)
      const sanitizedNote = sanitizeInput(reviewerNote)
      const updatedNote = request.reviewer_note
        ? `${request.reviewer_note}\n${sanitizedNote}`.trim()
        : sanitizedNote

      let updatedRequest
      try {
        // Use the dedicated acceptRequestWithReview method for reliable status update
        updatedRequest = await requestService.acceptRequestWithReview(
          requestId,
          reviewerId,
          updatedNote || undefined
        )
        console.log(`[SellerApproval] Request ${requestId} status updated to ACCEPTED`)
      } catch (updateError: any) {
        console.error(`[SellerApproval] Failed to update request status:`, updateError.message)
        console.error(`[SellerApproval] Update error details:`, updateError.stack || updateError)
        throw updateError
      }

      console.log(`[SellerApproval] Request ${requestId} approved by reviewer ${reviewerId}`)

      try {
        const vendorPanelUrl = process.env.VENDOR_PANEL_URL || process.env.VENDOR_URL || ""
        const onboardingUrl =
          process.env.VENDOR_ONBOARDING_URL ||
          (vendorPanelUrl ? appendPath(vendorPanelUrl, "/onboarding") : "")
        const loginUrl = vendorPanelUrl ? appendPath(vendorPanelUrl, "/login") : ""

        await sendVendorAcceptedNotificationWorkflow.run({
          container: this.container,
          input: {
            seller_id: seller.id,
            seller_name: seller.name,
            member_email: data.member.email,
            member_name: data.member.name,
            vendor_panel_url: vendorPanelUrl || undefined,
            onboarding_url: onboardingUrl || undefined,
            login_url: loginUrl || undefined,
          },
        })
        console.log(`[SellerApproval] Vendor acceptance notification sent to ${maskEmail(data.member.email)}`)
      } catch (notificationError: any) {
        console.warn(`[SellerApproval] Failed to send vendor acceptance notification: ${notificationError.message}`)
      }

      return {
        seller: {
          id: seller.id,
          name: seller.name,
          handle: seller.handle,
        },
        request: {
          id: updatedRequest.id,
          status: updatedRequest.status as RequestStatus,
        },
        matrixCreated,
      }
    } catch (error: any) {
      // Compensating actions for critical failures
      console.error(`[SellerApproval] Error during approval: ${error.message}`)

      // If seller was created but auth wasn't updated, we have an orphaned seller
      // Log this for manual intervention as we can't easily delete the seller
      if (createdSeller && !authUpdated) {
        console.error(`[SellerApproval] CRITICAL: Seller ${createdSeller.id} created but auth not linked. Manual intervention required.`)
      }

      throw error
    }
  }

  /**
   * Reject a request
   */
  async rejectRequest(input: RequestRejectionInput): Promise<{ id: string; status: RequestStatus }> {
    const { requestId, reviewerId, reason } = input
    const requestService = this.container.resolve<RequestModuleService>(REQUEST_MODULE)

    // Get and validate the request
    const requests = await requestService.listRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Request not found")
    }

    const request = requests[0]

    // Allow approving previously rejected requests to recover accidental rejections.
    if (request.status !== RequestStatus.PENDING && request.status !== RequestStatus.REJECTED) {
      throw new Error(`Request cannot be approved from status ${request.status}`)
    }

    // Use the dedicated rejectRequestWithReview method
    const sanitizedReason = sanitizeInput(reason)
    const updatedRequest = await requestService.rejectRequestWithReview(
      requestId,
      reviewerId,
      sanitizedReason || undefined
    )

    console.log(`[SellerApproval] Request ${requestId} rejected by reviewer ${reviewerId}${sanitizedReason ? `: ${sanitizedReason}` : ""}`)

    return {
      id: updatedRequest.id,
      status: updatedRequest.status as RequestStatus,
    }
  }

  /**
   * Approve a non-seller request (generic approval)
   */
  async approveGenericRequest(input: SellerApprovalInput): Promise<{ id: string; status: RequestStatus }> {
    const { requestId, reviewerId, reviewerNote } = input
    const requestService = this.container.resolve<RequestModuleService>(REQUEST_MODULE)

    // Get and validate the request
    const requests = await requestService.listRequests({ id: requestId })
    if (requests.length === 0) {
      throw new Error("Request not found")
    }

    const request = requests[0]

    // Allow approving previously rejected requests to recover accidental rejections.
    if (request.status !== RequestStatus.PENDING && request.status !== RequestStatus.REJECTED) {
      throw new Error(`Request cannot be approved from status ${request.status}`)
    }

    // Build updated reviewer note
    const sanitizedNote = sanitizeInput(reviewerNote)
    const updatedNote = request.reviewer_note
      ? `${request.reviewer_note}\n${sanitizedNote}`.trim()
      : sanitizedNote

    // Use the dedicated acceptRequestWithReview method
    const updatedRequest = await requestService.acceptRequestWithReview(
      requestId,
      reviewerId,
      updatedNote || undefined
    )

    console.log(`[SellerApproval] Generic request ${requestId} approved by reviewer ${reviewerId}`)

    try {
      const customerContact = await this.resolveCustomerContact({
        submitter_id: request.submitter_id,
        data: request.data as Record<string, unknown> | undefined,
      })

      if (!customerContact?.email) {
        console.warn(`[SellerApproval] No customer contact found for request ${requestId}`)
      } else {
        const storefrontUrl = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL || ""
        const loginUrl = storefrontUrl ? `${storefrontUrl}/account` : ""

        await sendCustomerAcceptedNotificationWorkflow.run({
          container: this.container,
          input: {
            customer_email: customerContact.email,
            customer_name: customerContact.name,
            storefront_url: storefrontUrl || undefined,
            login_url: loginUrl || undefined,
          },
        })
        console.log(`[SellerApproval] Customer acceptance notification sent to ${maskEmail(customerContact.email)}`)
      }
    } catch (notificationError: any) {
      console.warn(`[SellerApproval] Failed to send customer acceptance notification: ${notificationError.message}`)
    }

    return {
      id: updatedRequest.id,
      status: updatedRequest.status as RequestStatus,
    }
  }
}

/**
 * Factory function to create SellerApprovalService
 */
export function getSellerApprovalService(container: MedusaContainer): SellerApprovalService {
  return new SellerApprovalService(container)
}
