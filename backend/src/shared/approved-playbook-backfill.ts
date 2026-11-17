import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules, toHandle } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../modules/request"
import type RequestModuleService from "../modules/request/service"
import { RequestStatus } from "../modules/request/models"
import { REQUEST_TYPES } from "../modules/request/validators"
import { PLAYBOOK_MODULE, type PlaybookId } from "../modules/playbook"
import type PlaybookService from "../modules/playbook/service"
import {
  ALREADY_ASSIGNED_MESSAGE,
  assignPlaybookWorkflow,
} from "../workflows/assign-playbook"
import { isUnfinishedApprovalOf, resolveLinkedStore } from "./linked-store"
import {
  playbookAssignmentFor,
  validateSellerRequestData,
} from "./seller-approval-service"

/**
 * Give every seller approved while the playbook registry was empty the
 * playbook its approved application recorded.
 *
 * Approval assigns the application's playbook with the assign workflow,
 * which refuses a recipe the registry has no row for; until the registry was
 * seeded at boot it had none, and approval logged that as a warning, so
 * those sellers have no assignment at all (their multi-role features were
 * written regardless, by an earlier step). This reads each approved seller
 * application and, for the store that application made, assigns what
 * approval would have: `playbookAssignmentFor(request.data)`.
 *
 * Refuses, writing nothing for that seller:
 * - a seller who already has an assignment, whatever it is (the vendor may
 *   have picked one since). The write itself is `only_if_unassigned`, so an
 *   assignment made between the read and the write is not replaced;
 * - an application whose store cannot be told apart: the login it names is
 *   gone or is not linked to a live store, or its store is not the one this
 *   application made (`isUnfinishedApprovalOf`: the application's handle, a
 *   first member who is the applicant's owner and the member the login acts
 *   as, and no other approved application of the login). Approvals before
 *   SD-139 could link a login to another store; that store must not be
 *   given this application's playbook;
 * - a recipe the registry still has no row for.
 *
 * Dry run unless `apply`.
 */

export type ApprovedPlaybookEntry = {
  request_id: string
  seller_id?: string
  recipe_id?: PlaybookId
  roles?: PlaybookId[]
  /** Why it was refused or needs review. */
  reason?: string
}

export type ApprovedPlaybookBackfillSummary = {
  apply: boolean
  /** Written (apply only). */
  assigned: ApprovedPlaybookEntry[]
  /** Would be written (dry run only). */
  would_assign: ApprovedPlaybookEntry[]
  /** Refused: the seller already has an assignment. Nothing written. */
  already_assigned: ApprovedPlaybookEntry[]
  /** Refused for another reason, given in `reason`. Nothing written. */
  review: ApprovedPlaybookEntry[]
}

/**
 * A failed workflow run rejects with the step's error serialized to a plain
 * object, not an Error, so its message is read off either.
 */
const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === "string" ? message : String(error)
}

export async function backfillApprovedSellerPlaybooks(
  container: MedusaContainer,
  opts: { apply: boolean }
): Promise<ApprovedPlaybookBackfillSummary> {
  const summary: ApprovedPlaybookBackfillSummary = {
    apply: opts.apply,
    assigned: [],
    would_assign: [],
    already_assigned: [],
    review: [],
  }
  const requests = await container
    .resolve<RequestModuleService>(REQUEST_MODULE)
    .listRequests(
      {
        type: [REQUEST_TYPES.SELLER, REQUEST_TYPES.SELLER_CREATION],
        status: [RequestStatus.ACCEPTED, RequestStatus.COMPLETED],
      },
      { order: { created_at: "ASC" } }
    )
  const auth = container.resolve(Modules.AUTH)
  const playbooks = container.resolve<PlaybookService>(PLAYBOOK_MODULE)

  for (const request of requests) {
    const entry: ApprovedPlaybookEntry = { request_id: request.id }
    const refuse = (reason: string) => summary.review.push({ ...entry, reason })

    let data: ReturnType<typeof validateSellerRequestData>
    try {
      data = validateSellerRequestData(request.data)
    } catch (error) {
      refuse(`its data cannot be read: ${messageOf(error)}`)
      continue
    }

    const [login] = await auth.listAuthIdentities({ id: [data.auth_identity_id] })
    if (!login) {
      refuse(`the login it names (${data.auth_identity_id}) no longer exists`)
      continue
    }
    const linked = await resolveLinkedStore(
      container,
      login.app_metadata as Record<string, unknown> | undefined,
      login.id
    )
    if (linked.kind !== "live") {
      refuse(`its login is not linked to a live store (link: ${linked.kind})`)
      continue
    }
    entry.seller_id = linked.seller.id
    const madeByThisApplication = await isUnfinishedApprovalOf(container, linked, {
      requestId: request.id,
      loginId: login.id,
      handle: toHandle(data.seller.name),
      applicantEmail: data.member.email,
    })
    if (!madeByThisApplication) {
      refuse(
        `its login's store "${linked.seller.name}" is not one this application made (its web address, its first owner, or another approved application of the login differs)`
      )
      continue
    }

    const [existing] = await playbooks.listPlaybookAssignments({ seller_id: linked.seller.id })
    if (existing) {
      summary.already_assigned.push({
        ...entry,
        recipe_id: existing.recipe_id as PlaybookId,
        reason: `the seller ${ALREADY_ASSIGNED_MESSAGE} ("${existing.recipe_id}")`,
      })
      continue
    }

    const playbook = playbookAssignmentFor(data)
    entry.recipe_id = playbook.recipe_id
    entry.roles = playbook.metadata.roles
    const [registryRow] = await playbooks.listPlaybooks({ recipe_id: playbook.recipe_id })
    if (!registryRow) {
      refuse(
        `the playbook registry has no "${playbook.recipe_id}" row yet; start the backend once (its loader seeds the registry) and run this again`
      )
      continue
    }

    if (!opts.apply) {
      summary.would_assign.push(entry)
      continue
    }
    try {
      await assignPlaybookWorkflow(container).run({
        input: {
          seller_id: linked.seller.id,
          recipe_id: playbook.recipe_id,
          recommended_recipe_id: playbook.recommended_recipe_id,
          metadata: playbook.metadata,
          only_if_unassigned: true,
        },
      })
      summary.assigned.push(entry)
    } catch (error) {
      const message = messageOf(error)
      if (message.includes(ALREADY_ASSIGNED_MESSAGE) || /duplicate key|unique/i.test(message)) {
        summary.already_assigned.push({
          ...entry,
          reason: `the seller ${ALREADY_ASSIGNED_MESSAGE}, made since it was read; nothing was changed`,
        })
      } else {
        refuse(`assigning failed, nothing was written: ${message}`)
      }
    }
  }

  return summary
}
