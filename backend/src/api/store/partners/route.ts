import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isPartnerKind,
  isPartnerServes,
  PARTNER_DIRECTORY_MODULE,
  PARTNER_KINDS,
  PARTNER_SERVES,
  type PartnerKind,
} from "../../../modules/partner-directory"
import type PartnerDirectoryModuleService from "../../../modules/partner-directory/service"

/**
 * GET /store/partners?kind=&state=&serves=
 *
 * The refer-out partner directory (`docs/CDFI_COOP_ROADMAP.md` §3.2): CDFIs,
 * credit unions, microlenders, crowdfunders, legal and back-office help.
 * Code-sourced, like `/store/startup-guides`; public, like `/store/quest-catalog`.
 * Nothing here takes a vendor's data or hands them to a partner — every row
 * is a link out, and the response carries no vendor context at all.
 *
 * `kind` accepts one value or a comma-separated list; `state` is a two-letter
 * USPS code (national entries always match); `serves` is one audience.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = req.query as Record<string, unknown>

  let kind: PartnerKind[] | undefined
  if (typeof q.kind === "string" && q.kind.length > 0) {
    const kinds = q.kind.split(",").map((k) => k.trim()).filter(Boolean)
    const bad = kinds.filter((k) => !isPartnerKind(k))
    if (bad.length > 0) {
      return res.status(400).json({
        message: `Unknown kind: ${bad.join(", ")}`,
        allowed: PARTNER_KINDS,
      })
    }
    kind = kinds as PartnerKind[]
  }

  let state: string | undefined
  if (typeof q.state === "string" && q.state.length > 0) {
    if (!/^[A-Za-z]{2}$/.test(q.state)) {
      return res.status(400).json({ message: "state must be a two-letter USPS code" })
    }
    state = q.state.toUpperCase()
  }

  let serves: (typeof PARTNER_SERVES)[number] | undefined
  if (typeof q.serves === "string" && q.serves.length > 0) {
    if (!isPartnerServes(q.serves)) {
      return res.status(400).json({ message: `Unknown serves: ${q.serves}`, allowed: PARTNER_SERVES })
    }
    serves = q.serves
  }

  const directory = req.scope.resolve<PartnerDirectoryModuleService>(PARTNER_DIRECTORY_MODULE)
  const partners = directory.list({ kind, state, serves }).map((entry) => ({
    key: entry.key,
    name: entry.name,
    url: entry.url,
    tagline: entry.tagline,
    kind: entry.kind,
    states: entry.states,
    serves: entry.serves,
    products: entry.products,
  }))

  return res.status(200).json({
    partners,
    count: partners.length,
    kinds: PARTNER_KINDS,
    serves: PARTNER_SERVES,
  })
}
