import { createLogger } from "../../shared/logger"
const log = createLogger("api/shared/seller-registration")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../modules/request"
import RequestModuleService from "../../modules/request/service"
import { RequestStatus } from "../../modules/request/models"
import { REQUEST_TYPES } from "../../modules/request/validators"
import {
  createSellerRegistrationSchema,
  CreateSellerRegistrationInput,
} from "../vendor/register/validators"
import { maskEmail } from "../../shared/seller-approval-service"

export const handleSellerRegistration = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  let body: CreateSellerRegistrationInput
  try {
    body = createSellerRegistrationSchema.parse(req.body)
  } catch (validationError) {
    const ve = validationError as { errors?: Array<{ message?: string }> }
    log.error("[Seller registration] Validation error")
    return res.status(400).json({
      type: "invalid_data",
      message: ve.errors?.[0]?.message || "Invalid request data",
      errors: ve.errors,
    })
  }

  log.info(
    `[Seller registration] Creating request: "${body.name}" (email: ${maskEmail(
      body.member.email
    )})`
  )

  try {
    const authModule = req.scope.resolve(Modules.AUTH)
    const [authIdentity] = await authModule.listAuthIdentities({
      provider_identities: {
        entity_id: body.member.email,
      },
    })

    if (!authIdentity) {
      log.error(
        `[Seller registration] Auth identity not found for email: ${maskEmail(
          body.member.email
        )}`
      )
      return res.status(400).json({
        type: "invalid_data",
        message: "Please complete authentication registration first",
      })
    }

    log.info(`[Seller registration] Found auth identity: ${authIdentity.id}`)

    const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
    const existingRequests = await requestService.listRequests({
      type: REQUEST_TYPES.SELLER,
      submitter_id: authIdentity.id,
      status: RequestStatus.PENDING,
    })

    const userExistingRequest = existingRequests[0]

    if (userExistingRequest) {
      log.info(
        `[Seller registration] Found existing pending request: ${userExistingRequest.id}`
      )
      return res.status(200).json({
        request: {
          id: userExistingRequest.id,
          status: userExistingRequest.status || "pending",
          message:
            "You already have a pending registration request. Please wait for admin approval.",
        },
      })
    }

    const sellerRequest = await requestService.createRequest({
      type: REQUEST_TYPES.SELLER,
      data: {
        auth_identity_id: authIdentity.id,
        member: {
          name: body.member.name,
          email: body.member.email,
        },
        seller: {
          name: body.name,
        },
        vendor_type: body.vendor_type || "general",
        playbook: body.playbook,
        roles: body.roles,
        recommended_playbook: body.recommended_playbook,
        resources: body.resources,
      },
      submitter_id: authIdentity.id,
      reviewer_note: `Seller registration request for "${body.name}"`,
    })

    log.info(`[Seller registration] Created request: ${sellerRequest.id}`)

    return res.status(201).json({
      request: {
        id: sellerRequest.id,
        status: sellerRequest.status || "pending",
        message:
          "Your seller registration request has been submitted and is pending approval.",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("[Seller registration] Failed to create request:", message)

    return res.status(400).json({
      type: "invalid_data",
      message: message || "Failed to submit seller registration request",
    })
  }
}
