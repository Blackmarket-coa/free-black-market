import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../../../shared/logger"
import { sellerId, wellnessService, fail, body } from "../../../_helpers"

const log = createLogger("api/vendor/wellness/clients/[id]/notes")

async function ownsClient(req: AuthenticatedMedusaRequest, seller: string, id: string) {
  const rows = (await wellnessService(req).listClientProfiles(
    { id, seller_id: seller },
    { take: 1 }
  )) as Array<{ id: string }>
  return Boolean(rows?.[0])
}

// GET practitioner-only notes for a client. Never exposed to the client.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    if (!(await ownsClient(req, seller, req.params.id)))
      return res.status(404).json({ message: "Not found" })
    const notes = await wellnessService(req).listClientNotes(
      { client_profile_id: req.params.id, seller_id: seller },
      { order: { created_at: "DESC" } }
    )
    return res.json({ notes })
  } catch (e) {
    return fail(res, log, "GET client notes", e)
  }
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    if (!(await ownsClient(req, seller, req.params.id)))
      return res.status(404).json({ message: "Not found" })
    const b = body<{ body: string; booking_id?: string; is_private?: boolean }>(req)
    if (!b.body) return res.status(400).json({ message: "body is required" })
    const note = await wellnessService(req).addClientNote({
      seller_id: seller,
      client_profile_id: req.params.id,
      booking_id: b.booking_id ?? null,
      body: b.body,
      is_private: b.is_private ?? true,
    })
    return res.status(201).json({ note })
  } catch (e) {
    return fail(res, log, "POST client note", e)
  }
}
