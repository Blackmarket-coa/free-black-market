import { createLogger } from "./logger"
const log = createLogger("shared/seller-approval-service")
import { MedusaContainer } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys, toHandle } from "@medusajs/framework/utils"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { isUnfinishedApprovalOf, resolveLinkedStore } from "./linked-store"
import { STORE_NAME_NEEDS_LATIN, storeHandleFor } from "./store-handle"
import { createSellerMetadataWorkflow } from "../workflows/create-seller-metadata"
import { assignPlaybookWorkflow } from "../workflows/assign-playbook"
import {
  LEGACY_VENDOR_TYPE_TO_PLAYBOOK,
  PLAYBOOK_IDS,
  unionFeatureKeys,
  type PlaybookId,
} from "../modules/playbook"
import { sendVendorAcceptedNotificationWorkflow } from "../workflows/send-vendor-accepted-notification"
import { provisionNodeOperator } from "./provision-node-operator"
import { appendPath } from "./url"
import { sendCustomerAcceptedNotificationWorkflow } from "../workflows/send-customer-accepted-notification"
import { VendorType } from "../modules/seller-extension/models/seller-metadata"
import { SELLER_EXTENSION_MODULE } from "../modules/seller-extension"
import type SellerExtensionService from "../modules/seller-extension/service"
import {
  listSellerMetadataRecords,
  updateSellerMetadataRecord,
} from "../modules/seller-extension/metadata-service"
import { GOVERNANCE_POWER_LEVEL } from "./matrix-service"
import { getChatProvider } from "./chat"
import { REQUEST_MODULE } from "../modules/request"
import RequestModuleService from "../modules/request/service"
import { RequestStatus } from "../modules/request/models"
import { isSellerRequestType } from "../modules/request/validators"

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
 * An approval refused for a reason the reviewer can act on, with the status
 * `POST /admin/requests/:id/approve` answers. Thrown before anything is
 * created or linked: the request stays as it was.
 */
export class SellerApprovalRefusedError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string
  ) {
    super(message)
    this.name = "SellerApprovalRefusedError"
  }
}

/**
 * Whether createSellerWorkflow failed because another store has this handle.
 * Mercur's createSellerStep creates the seller with `handle: toHandle(name)`,
 * and Medusa's DB error mapper turns the unique-index violation into exactly
 * this message (table, key and value). Compared whole, so no other error that
 * happens to say "already exists" (setAuthAppMetadataStep's "Key seller_id
 * already exists in app metadata") reads as a name clash.
 */
export const isHandleClash = (error: unknown, handle: string): boolean =>
  (error as { message?: unknown } | null)?.message === `Seller with handle: ${handle}, already exists.`

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
export interface SellerRequestData {
  auth_identity_id: string
  member: {
    name: string
    email: string
  }
  seller: {
    name: string
  }
  vendor_type?: string
  /**
   * The seller asked to run a Blackstar logistics node, answered in the
   * onboarding survey. This, not vendor_type, is what decides whether approval
   * hands them node credentials.
   */
  node_operator_opt_in?: boolean
  /** Primary playbook chosen via the resource quiz (canonical classification). */
  playbook?: string
  /** All roles the user selected (includes the primary). */
  roles?: string[]
  /** Playbook the quiz recommended before any override. */
  recommended_playbook?: string
  /** Resources the user reported in the quiz. */
  resources?: string[]
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
 * Validates seller request data structure, and returns the fields approval
 * reads from it. A field left out here reaches approval as undefined:
 * `node_operator_opt_in` was, so every applicant who ticked "Sign me up to
 * carry deliveries" was approved with the flag off and never provisioned.
 */
export function validateSellerRequestData(data: unknown): SellerRequestData {
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
    // Only a stored `true` opts in: registration writes a boolean.
    node_operator_opt_in: d.node_operator_opt_in === true,
    playbook: typeof d.playbook === "string" ? d.playbook : undefined,
    roles: Array.isArray(d.roles)
      ? d.roles.filter((r): r is string => typeof r === "string")
      : undefined,
    recommended_playbook:
      typeof d.recommended_playbook === "string" ? d.recommended_playbook : undefined,
    resources: Array.isArray(d.resources)
      ? d.resources.filter((r): r is string => typeof r === "string")
      : undefined,
  }
}

/**
 * The playbook assignment an approved application records: its primary
 * playbook (or the legacy vendor_type's, or stall), the full role set, what
 * the quiz recommended, and the resources it reported; plus, for a seller
 * with more than one role, the union of the roles' features that approval
 * writes to the seller's metadata. Approval assigns this, and
 * `shared/approved-playbook-backfill.ts` assigns the same thing to sellers
 * approved while the playbook registry was empty.
 */
export function playbookAssignmentFor(data: SellerRequestData): {
  recipe_id: PlaybookId
  recommended_recipe_id?: PlaybookId
  metadata: { roles: PlaybookId[]; resources?: string[] }
  enabled_extensions: string[] | null
} {
  const isPlaybookId = (value: unknown): value is PlaybookId =>
    typeof value === "string" && (PLAYBOOK_IDS as string[]).includes(value)
  const vendorType = data.vendor_type || VendorType.GENERAL
  const primary: PlaybookId = isPlaybookId(data.playbook)
    ? data.playbook
    : LEGACY_VENDOR_TYPE_TO_PLAYBOOK[vendorType] ?? "stall"
  const selectedRoles = Array.isArray(data.roles) ? data.roles.filter(isPlaybookId) : []
  const roles = Array.from(new Set<PlaybookId>([primary, ...selectedRoles]))
  return {
    recipe_id: primary,
    recommended_recipe_id: isPlaybookId(data.recommended_playbook)
      ? data.recommended_playbook
      : undefined,
    metadata: {
      roles,
      ...(data.resources?.length ? { resources: data.resources } : {}),
    },
    enabled_extensions: roles.length > 1 ? unionFeatureKeys(roles) : null,
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
      log.error(`[SellerApproval] Request data validation failed:`, validationError.message)
      log.error(`[SellerApproval] Request data was:`, JSON.stringify(request.data, null, 2))
      throw new Error(`Invalid request data: ${validationError.message}`)
    }
    const vendorType = data.vendor_type || VendorType.GENERAL

    log.info(`[SellerApproval] Processing approval for seller "${data.seller.name}" (email: ${maskEmail(data.member.email)})`)

    // Step 2.5: Verify auth identity exists before proceeding
    const authModule = this.container.resolve(Modules.AUTH)
    const authIdentities = await authModule.listAuthIdentities(
      { id: [data.auth_identity_id] },
      { relations: ["provider_identities"] }
    )
    if (!authIdentities || authIdentities.length === 0) {
      log.error(`[SellerApproval] Auth identity not found: ${data.auth_identity_id}`)
      throw new Error(`Auth identity not found. The user may need to re-register.`)
    }
    const applicantLogin = authIdentities[0]

    // Step 2.6: The application must be the one seller registration writes:
    // filed by the login it names, under that login's own address. Rows from
    // the doors closed by SD-127 (the generic request routes, a body email
    // that picked the login) carry any login and any address, and approving
    // one gives that login a store, or a store that address.
    if (request.submitter_id !== data.auth_identity_id) {
      throw new SellerApprovalRefusedError(
        400,
        "This application names a login other than the one that filed it, so it did not come through seller registration and cannot be approved. Reject it; the applicant can apply again from the vendor panel."
      )
    }
    const loginEmail = applicantLogin.provider_identities?.find(
      (p) => p.provider === "emailpass"
    )?.entity_id
    if (!loginEmail || loginEmail.trim().toLowerCase() !== data.member.email.trim().toLowerCase()) {
      throw new SellerApprovalRefusedError(
        400,
        "This application's member email is not the address of the login it names, so it cannot be approved. Reject it; the applicant can apply again from the vendor panel."
      )
    }
    log.info(`[SellerApproval] Auth identity verified: ${data.auth_identity_id}`)

    // Step 2.7: A login that already holds a store gets no other one. Decided
    // before the workflow runs: Mercur's createSellerWorkflow refuses a linked
    // login only in its last steps ("Key seller_id already exists in app
    // metadata"), after creating the new store, and that message once passed
    // for a name clash, which resumed approval onto the store the login had
    // been invited into (SD-127 re-review, reproduced on Postgres).
    const handle = toHandle(data.seller.name)
    const linked = await resolveLinkedStore(
      this.container,
      applicantLogin.app_metadata as Record<string, unknown> | undefined,
      applicantLogin.id
    )
    if (linked.kind === "closed") {
      throw new SellerApprovalRefusedError(
        409,
        "This login is linked to a store that was closed, so this application cannot be approved. Nothing was created or linked. Reject it, and ask the applicant to contact support."
      )
    }
    // A seller id naming an open store where the login has no member at its
    // address, live or removed: an owner whose member email drifted from the
    // login's address holds one. Clearing it and approving, as for a removed
    // member, left that store's member row live and linked to no login
    // (follow-up re-review, R-b).
    if (linked.kind === "unmatched") {
      throw new SellerApprovalRefusedError(
        409,
        `This login's link to the existing store "${linked.seller.name}" (${linked.seller.id}) needs support to fix: no member of that store, live or removed, has the login's address, so approving would leave that store's members linked to no login. Nothing was created or changed. Fix the link or the member's email first.`
      )
    }
    // The one store approval resumes onto: the one an earlier approval of
    // this application created and linked before a later step failed.
    const resumeOnto =
      linked.kind === "live" &&
      (await isUnfinishedApprovalOf(this.container, linked, {
        requestId,
        loginId: data.auth_identity_id,
        handle,
        applicantEmail: data.member.email,
      }))
        ? linked.seller
        : null
    if (linked.kind === "live" && !resumeOnto) {
      throw new SellerApprovalRefusedError(
        409,
        `This login already has a store ("${linked.seller.name}"), so this application cannot be approved. Nothing was created or linked. Reject it.`
      )
    }
    // A store is made with handle toHandle(name), and every name with no
    // Latin letter or digit makes the same "-" or "": the first such store got
    // it and every later one failed as a name clash it was not.
    if (!resumeOnto && !storeHandleFor(data.seller.name)) {
      throw new SellerApprovalRefusedError(
        400,
        `${STORE_NAME_NEEDS_LATIN} "${data.seller.name}" has none, so this application cannot be approved. Nothing was created or linked. Reject it, then ask the applicant to apply again with a store name that has one.`
      )
    }
    // After every refusal that needs no store made, so none of them changes
    // anything (a name clash, which only the workflow finds, refuses with the
    // link already cleared). A link that acts as no member of a store that is
    // still open because its member was removed (a removed member's id, or a
    // seller id whose member at the login's address was removed) names no
    // store of this login's, and Mercur's setAuthAppMetadataStep refuses any
    // login whose seller_id is set ("Key seller_id already exists in app
    // metadata"). Approval used to refuse it as "linked to a store that was
    // closed" while the store was live.
    // `undefined` removes the key: the auth module merges app_metadata, so
    // leaving the key out keeps it, and null keeps it set (measured).
    if (linked.kind === "removed") {
      log.warn(
        `[SellerApproval] Login ${data.auth_identity_id}'s link ${linked.actor} acts as no member of store ${linked.seller.id} (a removed member's id, or a seller id whose member at the login's address was removed); clearing that link before creating its own store (request ${requestId})`
      )
      await authModule.updateAuthIdentities([
        { id: data.auth_identity_id, app_metadata: { seller_id: undefined } },
      ])
    }

    let createdSeller: { id: string; name: string; handle?: string } | null = null
    let authUpdated = false

    try {
      let seller: { id: string; name: string; handle?: string }

      if (resumeOnto) {
        log.info(`[SellerApproval] Resuming approval onto this login's own store: ${resumeOnto.id}`)
        seller = resumeOnto
        createdSeller = seller
      } else {
        // Step 3: Create the seller using MercurJS workflow
        log.info(`[SellerApproval] Starting seller workflow with auth_identity_id: ${data.auth_identity_id}`)

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
        log.info(`[SellerApproval] Workflow input:`, JSON.stringify(workflowInput, null, 2))

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
          log.info(`[SellerApproval] Seller created with ID: ${seller.id}`)
        } catch (workflowError: any) {
          // A name clash is the seller handle's unique index and nothing else:
          // Medusa's DB error mapper words it "Seller with handle: <handle>,
          // already exists." Another store has the handle this name makes. No
          // store is linked: the lookups by member email and by handle that
          // used to run here gave the applicant someone else's store.
          if (isHandleClash(workflowError, handle)) {
            log.warn(`[SellerApproval] Refused request ${requestId}: a store already has the handle "${handle}"`)
            throw new SellerApprovalRefusedError(
              409,
              `The store name "${data.seller.name}" gives the web address "${handle}", which another store already uses, so this application cannot be approved. Nothing was created or linked. Reject it, then ask the applicant to apply again with another store name.`
            )
          }
          log.error(`[SellerApproval] Workflow execution failed:`, workflowError.message)
          log.error(`[SellerApproval] Workflow error details:`, workflowError)
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
      log.info(`[SellerApproval] Auth identity linked successfully`)

      // Resolve the primary playbook + the full role set the seller chose,
      // plus the feature-union override applied for multi-role sellers.
      const playbook = playbookAssignmentFor(data)
      const enabledExtensions = playbook.enabled_extensions

      // Step 5: Create seller metadata with vendor_type
      try {
        const vendorTypeEnum = VendorType[vendorType.toUpperCase() as keyof typeof VendorType] || VendorType.GENERAL

        await createSellerMetadataWorkflow.run({
          container: this.container,
          input: {
            seller_id: seller.id,
            vendor_type: vendorTypeEnum,
            enabled_extensions: enabledExtensions,
            // Carry the survey answer onto the metadata row so the settings
            // page agrees with the credential provisioning below.
            node_operator_opt_in: data.node_operator_opt_in === true,
          },
        })
        log.info(`[SellerApproval] Metadata created with vendor_type: ${vendorTypeEnum}${enabledExtensions ? ` (+${enabledExtensions.length} union features)` : ""}`)
      } catch (metadataError: any) {
        // Non-critical, but nothing creates the row later on its own: the
        // sellerCreated subscriber listens for an event nothing emits (see
        // the reconcile below). A route that writes seller metadata creates
        // the row when it first needs one.
        log.warn(`[SellerApproval] Metadata creation failed (will use fallback): ${metadataError.message}`)
      }

      // Step 5.5: Assign the canonical (primary) playbook captured by the
      // registration resource quiz, recording the full role set + resources
      // on the assignment. Non-blocking: a vendor without an assignment is
      // offered the picker during onboarding.
      try {
        await assignPlaybookWorkflow.run({
          container: this.container,
          input: {
            seller_id: seller.id,
            recipe_id: playbook.recipe_id,
            recommended_recipe_id: playbook.recommended_recipe_id,
            metadata: playbook.metadata,
          },
        })
        log.info(`[SellerApproval] Playbook assigned: ${playbook.recipe_id} (roles: ${playbook.metadata.roles.join(", ")})`)
      } catch (playbookError: any) {
        // Non-critical: vendor can pick a playbook during onboarding.
        log.warn(`[SellerApproval] Playbook assignment failed (onboarding picker will handle it): ${playbookError.message}`)
      }

      // Step 6: Provision Matrix (Blackout) user + vendor room (non-blocking)
      let matrixCreated = false
      const matrixService = getChatProvider()
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
          log.info(`[SellerApproval] Matrix account provisioned: ${mxid}`)
        } catch (matrixError: any) {
          log.warn(`[SellerApproval] Matrix provisioning failed (non-blocking): ${matrixError.message}`)
        }
      }

      // Step 7: Update request status and reviewer info using dedicated service method
      log.info(`[SellerApproval] Step 7: Updating request status to ACCEPTED...`)
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
        log.info(`[SellerApproval] Request ${requestId} status updated to ACCEPTED`)
      } catch (updateError: any) {
        log.error(`[SellerApproval] Failed to update request status:`, updateError.message)
        log.error(`[SellerApproval] Update error details:`, updateError.stack || updateError)
        throw updateError
      }

      log.info(`[SellerApproval] Request ${requestId} approved by reviewer ${reviewerId}`)

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
        log.info(`[SellerApproval] Vendor acceptance notification sent to ${maskEmail(data.member.email)}`)
      } catch (notificationError: any) {
        log.warn(`[SellerApproval] Failed to send vendor acceptance notification: ${notificationError.message}`)
      }

      try {
        // An applicant who answered yes to carrying deliveries becomes a
        // Blackstar node operator. Only that answer decides it: not the
        // playbook, the resources or the vendor type (`vendor_type ===
        // "logistics"` used to, with the question answered no). Best effort:
        // the bridge retries on its own, and an outage over there must never
        // fail or roll back an approval over here.
        //
        // What happens to the credential's secret, which approval has no one
        // to show to (no response field, no mail):
        // - Blackstar's emit not configured: nothing is issued and nothing is
        //   queued. The opt-in is recorded below, and the vendor issues the
        //   credential from Settings (POST /vendor/node-operator), which
        //   shows it once.
        // - configured: a credential is issued (stored encrypted, readable by
        //   no route) and its plaintext leaves in the `node.operator.approved`
        //   delivery; the delivery row holds it until Blackstar accepts it,
        //   then clears it, and the admin deliveries routes redact it. The
        //   vendor still gets a secret of their own only from Settings, which
        //   re-issues.
        const optedIn = data.node_operator_opt_in === true
        const provisioned = await provisionNodeOperator(this.container, {
          sellerId: seller.id,
          sellerName: seller.name,
          memberEmail: data.member.email,
          memberName: data.member.name,
          // Captured by the onboarding survey at registration.
          optedIn,
        })
        if (optedIn && !provisioned.emitted) {
          log.info(
            `[SellerApproval] ${seller.id} opted in to carry deliveries; no credential was issued (${provisioned.reason}). The opt-in is recorded and the vendor issues the credential from Settings.`
          )
        }

        // Record the answer on the metadata row whatever provisioning did.
        // Step 5 sets it when it creates the row, but step 5 can fail, or find
        // a row already there (seller_id is unique: an approval resumed onto
        // its store, or a route that wrote one first, keeps its defaults).
        // Either way the settings page would read back "off" for a seller who
        // said yes, and may hold a credential. Not the sellerCreated
        // subscriber, which this used to blame: it listens for an event named
        // "sellerCreated" that nothing emits (Mercur's createSellerWorkflow
        // declares a workflow hook of that name, not an event), so it never
        // runs.
        if (optedIn) {
          try {
            const sellerExtension = this.container.resolve<SellerExtensionService>(
              SELLER_EXTENSION_MODULE
            )
            const [meta] = await listSellerMetadataRecords(sellerExtension, {
              seller_id: seller.id,
            })
            if (meta && !meta.node_operator_opt_in) {
              await updateSellerMetadataRecord(sellerExtension, [
                { id: meta.id, node_operator_opt_in: true },
              ])
            }
          } catch (flagError: any) {
            log.warn(
              `[SellerApproval] Could not record node operator opt-in for ${seller.id}: ${flagError.message}`
            )
          }
        }
      } catch (provisionError: any) {
        log.warn(
          `[SellerApproval] Failed to provision node operator for ${seller.id}: ${provisionError.message}`
        )
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
      log.error(`[SellerApproval] Error during approval: ${error.message}`)

      // If seller was created but auth wasn't updated, we have an orphaned seller
      // Log this for manual intervention as we can't easily delete the seller
      if (createdSeller && !authUpdated) {
        log.error(`[SellerApproval] CRITICAL: Seller ${createdSeller.id} created but auth not linked. Manual intervention required.`)
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

    log.info(`[SellerApproval] Request ${requestId} rejected by reviewer ${reviewerId}${sanitizedReason ? `: ${sanitizedReason}` : ""}`)

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

    log.info(`[SellerApproval] Generic request ${requestId} approved by reviewer ${reviewerId}`)

    try {
      const customerContact = await this.resolveCustomerContact({
        submitter_id: request.submitter_id,
        data: request.data as Record<string, unknown> | undefined,
      })

      if (!customerContact?.email) {
        log.warn(`[SellerApproval] No customer contact found for request ${requestId}`)
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
        log.info(`[SellerApproval] Customer acceptance notification sent to ${maskEmail(customerContact.email)}`)
      }
    } catch (notificationError: any) {
      log.warn(`[SellerApproval] Failed to send customer acceptance notification: ${notificationError.message}`)
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
