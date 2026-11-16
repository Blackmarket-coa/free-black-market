import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { WellnessAutomationService } from "../../../../../modules/wellness/automation-service"
import { sellerId, fail, body } from "../../_helpers"

const log = createLogger("api/vendor/wellness/automations/test")

const normalise = (email: string) => email.trim().toLowerCase()

type SellerAddresses = {
  members?: Array<{ email?: string | null } | null> | null
  invites?: Array<{ email?: string | null } | null> | null
}

const addresses = (rows: Array<{ email?: string | null } | null> | null | undefined): string[] =>
  (rows ?? [])
    .map((r) => r?.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0)
    .map(normalise)

/**
 * Who a test send may go to: an address the seller has proven they control,
 * which is the member address the store was registered with, and no one else.
 *
 * The send itself is the seller's template, rendered with `vars` from this
 * request, so without this a seller could mail any text to any address: the
 * email fallback (template `wellness-automation`) was dropped silently until
 * its template existed, and once it does it goes out from FBM's domain. A
 * test is for seeing your own template, which needs no other inbox.
 *
 * A seller's member rows are written only by Mercur's createSellerWorkflow,
 * from a registration whose address got the /vendor/verify-email link (or
 * that an admin approved), and by its acceptMemberInvitesWorkflow, with the
 * invite's address. No vendor route edits a member's email. So the rule is
 * "the seller's members, minus any address one of its invites names":
 *
 *   - Invited members are out because accepting an invite proves nothing
 *     about the invited address: the inviting seller can read the token
 *     (`POST /vendor/invites?fields=token`, and the `invites` relation on
 *     other seller reads), so they could accept their own invite from a
 *     second login. Acceptance is broken in this repo today; this rule does
 *     not depend on it staying broken.
 *   - The store's profile `email` is out because the seller sets it:
 *     `POST /vendor/sellers/me` copies it with no verification, and only
 *     Medusa's `.strict()` on that route's body schema stops the write today.
 *   - Wellness clients and members are out because the seller writes those
 *     lists: `POST /vendor/wellness/clients` creates a profile for any
 *     address. Real automation sends do go to those lists; that residual is
 *     capped only by the per-seller hourly budget in the automation service
 *     (SD-70).
 */
export async function isAllowedTestRecipient(
  req: AuthenticatedMedusaRequest,
  seller: string,
  recipient: string
): Promise<boolean> {
  const wanted = normalise(recipient)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: ["members.email", "invites.email"],
    filters: { id: seller },
  })
  const row = (data?.[0] ?? null) as SellerAddresses | null
  const invited = new Set(addresses(row?.invites))
  const registered = addresses(row?.members).filter((e) => !invited.has(e))
  return registered.includes(wanted)
}

// POST /vendor/wellness/automations/test — send a test DM for a trigger.
// Body: { trigger, recipient_email, recipient_name?, vars? }
// The recipient must be the address the store was registered with
// (isAllowedTestRecipient). Rate limited per actor in
// `vendor/wellness/_middlewares.ts`; the per-seller hourly send budget in
// the automation service applies on top.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const b = body<{
      trigger: string
      recipient_email: string
      recipient_name?: string
      vars?: Record<string, string>
    }>(req)
    if (!b.trigger || !b.recipient_email || typeof b.recipient_email !== "string")
      return res.status(400).json({ message: "trigger and recipient_email are required" })

    const recipient = b.recipient_email.trim()
    if (!recipient || !(await isAllowedTestRecipient(req, seller, recipient))) {
      return res.status(403).json({
        message: "Test sends can go only to the email address your store was registered with.",
        type: "not_allowed",
      })
    }

    const automation = new WellnessAutomationService(req.scope)
    const result = await automation.runTrigger({
      seller_id: seller,
      trigger: b.trigger,
      vars: b.vars ?? { name: b.recipient_name ?? "there" },
      recipients: [{ email: recipient, name: b.recipient_name ?? null }],
    })
    return res.json({ result })
  } catch (e) {
    return fail(res, log, "POST automations/test", e)
  }
}
