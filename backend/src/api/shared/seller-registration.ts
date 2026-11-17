import { createLogger } from "../../shared/logger"
import { issueVerificationToken } from "../../shared/seller-email-verification"
import { sendSellerEmailVerificationWorkflow } from "../../workflows/send-seller-email-verification"

const log = createLogger("api/shared/seller-registration")
import {
  getAuthContextFromJwtToken,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { AuthIdentityDTO, ConfigModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../modules/request"
import RequestModuleService from "../../modules/request/service"
import { RequestStatus } from "../../modules/request/models"
import { REQUEST_TYPES } from "../../modules/request/validators"
import {
  createSellerRegistrationSchema,
  CreateSellerRegistrationInput,
} from "../vendor/register/validators"
import { maskEmail } from "../../shared/seller-approval-service"
import { resolveLinkedStore } from "../../shared/linked-store"
import { STORE_NAME_NEEDS_LATIN, storeHandleFor } from "../../shared/store-handle"

/**
 * The login a vendor application is filed for: the caller's own, read from a
 * seller token this server signed. Null for no token, a forged or expired one,
 * or a token for another actor type.
 *
 * It used to be whichever login held the email in the request body, so anyone
 * could file an application, and have its verification mail sent, in the name
 * of any login whose address they knew (SD-127).
 *
 * Verified the way Medusa's `authenticate("seller", "bearer",
 * { allowUnregistered: true })` verifies (same secret or public key, same
 * verify options, same actor-type rule), because the applicant holds the token
 * `POST /auth/seller/emailpass/register` returned, whose `actor_id` stays ""
 * until a seller exists. Bearer only: the vendor panel sends the token and
 * omits cookies, and `/auth/**` is outside the same-origin guard that makes
 * cookie auth safe on `/vendor/**`.
 */
export function applicantAuthIdentityId(req: MedusaRequest): string | null {
  const { http } = req.scope.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  ).projectConfig
  if (!http.jwtSecret && !http.jwtPublicKey) {
    return null
  }

  const context = getAuthContextFromJwtToken(
    req.headers.authorization,
    http.jwtSecret ?? "",
    ["bearer"],
    ["seller"],
    http.jwtPublicKey,
    http.jwtVerifyOptions ?? http.jwtOptions
  )
  const authIdentityId = context?.auth_identity_id
  return typeof authIdentityId === "string" && authIdentityId ? authIdentityId : null
}

/** The address a login signs in with: its emailpass identity's entity_id. */
const emailpassAddress = (identity: AuthIdentityDTO): string | null =>
  identity.provider_identities?.find((p) => p.provider === "emailpass")?.entity_id ?? null

const sameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

const unauthenticated = (res: MedusaResponse) =>
  res.status(401).json({
    type: "unauthorized",
    message: "Create your account or sign in before applying to sell.",
  })

export const handleSellerRegistration = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  // Before the body is read, as Medusa's authenticate middleware would: a
  // caller with no seller token learns nothing and nothing is written.
  const authIdentityId = applicantAuthIdentityId(req)
  if (!authIdentityId) {
    return unauthenticated(res)
  }

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
    const [authIdentity] = await authModule.listAuthIdentities(
      { id: [authIdentityId] },
      { relations: ["provider_identities"] }
    )

    if (!authIdentity) {
      // A valid token for a login that has since been deleted.
      log.warn(`[Seller registration] Token names no login: ${authIdentityId}`)
      return unauthenticated(res)
    }

    // The application is for the caller's login, so its address is that
    // login's: the verification mail goes there, and approval and the status
    // check match the seller's member row by it. A different address in the
    // body is refused rather than replaced, so the applicant is never told
    // "check your email" about a mailbox other than the one they typed. Only
    // the caller's own login is compared, never looked up by the body's
    // address, so the answer is the same whether or not that address has a
    // login of its own.
    const loginEmail = emailpassAddress(authIdentity)
    if (!loginEmail || !sameAddress(loginEmail, body.member.email)) {
      log.warn(
        `[Seller registration] Refused: body email ${maskEmail(
          body.member.email
        )} is not the address of login ${authIdentity.id}`
      )
      return res.status(403).json({
        type: "not_allowed",
        message: "Apply with the email address you signed in with.",
      })
    }

    // A login that already has a store applies for no other: approving a
    // second application relinked the login and re-ran the metadata and
    // playbook steps over the existing store (SD-127 review). One linked to a
    // store that was closed cannot apply here either, and is told why. A
    // login whose link names a member removed from a store that is still open
    // has no store, and applies like any other: it used to be told its store
    // "was closed" while the store was live.
    const linked = await resolveLinkedStore(
      req.scope,
      authIdentity.app_metadata as Record<string, unknown> | undefined,
      authIdentity.id
    )
    if (linked.kind === "live") {
      return res.status(409).json({
        type: "conflict",
        message: "This account already has a store. Sign in to the vendor panel to manage it.",
      })
    }
    if (linked.kind === "closed") {
      return res.status(409).json({
        type: "conflict",
        message: "This account is linked to a store that was closed. Contact support to reopen it or to apply again.",
      })
    }

    // The store's handle is toHandle(name), as Mercur's createSellerStep makes
    // it, and handles are unique. Refused now with something the applicant can
    // act on, rather than an approval that cannot create the store. A name
    // whose handle has no letter or digit is refused first: every such name
    // makes the same handle, so it would read as taken by the first store
    // that got one.
    const handle = storeHandleFor(body.name)
    if (!handle) {
      return res.status(400).json({
        type: "invalid_data",
        message: STORE_NAME_NEEDS_LATIN,
      })
    }
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: sameHandle } = await query.graph({
      entity: "seller",
      fields: ["id"],
      filters: { handle },
    })
    if (sameHandle.length > 0) {
      // Named by its web address: names that differ only outside a-z and 0-9
      // share one ("Ферма 1" and "Магазин 1" both make "-1"), and "a store
      // named ... already exists" was false for the second.
      return res.status(409).json({
        type: "conflict",
        message: `The store name "${body.name}" gives the web address "${handle}", which another store already uses. Choose another store name.`,
      })
    }

    log.info(`[Seller registration] Applicant login: ${authIdentity.id}`)

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
          email: loginEmail,
        },
        seller: {
          name: body.name,
        },
        vendor_type: body.vendor_type || "general",
        // "I also want to run deliveries." Answered in the onboarding survey;
        // it decides whether approval hands this seller node credentials.
        node_operator_opt_in: body.node_operator_opt_in === true,
        playbook: body.playbook,
        roles: body.roles,
        recommended_playbook: body.recommended_playbook,
        resources: body.resources,
      },
      submitter_id: authIdentity.id,
      reviewer_note: `Seller registration request for "${body.name}"`,
    })

    log.info(`[Seller registration] Created request: ${sellerRequest.id}`)

    // Approval is automatic, so proving control of the mailbox IS the gate on
    // becoming a seller — and, through the Blackstar bridge, on holding node
    // credentials. Only the hash is persisted; the raw token leaves in the mail.
    const { token, state } = issueVerificationToken()
    await requestService.updateRequests({
      selector: { id: sellerRequest.id },
      data: {
        data: { ...(sellerRequest.data as Record<string, unknown>), email_verification: state },
      },
    })

    try {
      await sendSellerEmailVerificationWorkflow(req.scope).run({
        input: {
          request_id: sellerRequest.id,
          member_email: loginEmail,
          member_name: body.member.name,
          seller_name: body.name,
          token,
        },
      })
    } catch (notifyError) {
      // The request and its token are already durable, so a mail outage must
      // not lose the registration. There is no route that sends a new link
      // yet: an applicant whose mail never arrives needs an admin.
      log.error(
        "[Seller registration] Verification email failed to send:",
        notifyError instanceof Error ? notifyError.message : String(notifyError)
      )
    }

    return res.status(201).json({
      request: {
        id: sellerRequest.id,
        status: sellerRequest.status || "pending",
        message:
          "Check your email and open the verification link to finish setting up your store.",
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
