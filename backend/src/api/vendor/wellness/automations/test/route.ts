import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { WellnessAutomationService } from "../../../../../modules/wellness/automation-service"
import { sellerId, fail, body, wellnessService } from "../../_helpers"

const log = createLogger("api/vendor/wellness/automations/test")

const normalise = (email: string) => email.trim().toLowerCase()

type SellerEmails = { email?: string | null; members?: Array<{ email?: string | null } | null> | null }

/**
 * Who a test send may go to: the seller's own address, a member of the
 * seller's team, or one of the seller's own wellness clients or members.
 *
 * The send itself is the seller's template, rendered with `vars` from this
 * request, so without this a seller could mail any text to any address: the
 * email fallback (template `wellness-automation`) was dropped silently until
 * its template existed, and once it does it goes out from FBM's domain. A
 * test is for seeing your own template, which needs no stranger's inbox.
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
    fields: ["email", "members.email"],
    filters: { id: seller },
  })
  const row = (data?.[0] ?? null) as SellerEmails | null
  const own = [row?.email, ...(row?.members ?? []).map((m) => m?.email)]
    .filter((e): e is string => typeof e === "string" && e.length > 0)
    .map(normalise)
  if (own.includes(wanted)) return true

  // Client and member rows are keyed by the address as it was entered, so
  // ask for both spellings.
  const emails = Array.from(new Set([recipient.trim(), wanted]))
  const wellness = wellnessService(req)
  const [clients, members] = await Promise.all([
    wellness.listClientProfiles({ seller_id: seller, email: emails }, { take: 1, select: ["id"] }),
    wellness.listMembers({ seller_id: seller, email: emails }, { take: 1, select: ["id"] }),
  ])
  return clients.length > 0 || members.length > 0
}

// POST /vendor/wellness/automations/test — send a test DM for a trigger.
// Body: { trigger, recipient_email, recipient_name?, vars? }
// The recipient must be the seller, a team member, or one of the seller's
// clients (isAllowedTestRecipient). Rate limited per actor in
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
        message: "Test sends can go only to your own email, your team, or one of your clients.",
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
