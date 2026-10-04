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
import type { PartnerOrgRecord } from "../../../modules/partner-directory/service"
import { featureFlagState } from "../../../shared/feature-flags"

/**
 * The public shape of a partner org. An explicit allow-list, not an omit:
 * `ein`, `stripe_connect_account_id`, `verification_source` and
 * `verification_checked_at` never leave the server, and a column added to the
 * model later is private until someone adds it here on purpose.
 *
 * `verified_as_of` is the IRS file's date and is public because legal
 * checkpoint L11 requires it be shown beside any status.
 */
export type PublicPartnerOrg = {
  key: string
  name: string
  org_type: PartnerOrgRecord["org_type"]
  verification_status: PartnerOrgRecord["verification_status"]
  verified_as_of: Date | null
  relationship: PartnerOrgRecord["relationship"]
  fiscal_host_key: string | null
  url: string | null
  tagline: string | null
  states: unknown
  serves: unknown
}

export const PUBLIC_PARTNER_ORG_FIELDS = [
  "key",
  "name",
  "org_type",
  "verification_status",
  "verified_as_of",
  "relationship",
  "fiscal_host_key",
  "url",
  "tagline",
  "states",
  "serves",
] as const

export function toPublicPartnerOrg(org: PartnerOrgRecord): PublicPartnerOrg {
  return {
    key: org.key,
    name: org.name,
    org_type: org.org_type,
    verification_status: org.verification_status,
    verified_as_of: org.verified_as_of ?? null,
    relationship: org.relationship,
    fiscal_host_key: org.fiscal_host_key ?? null,
    url: org.url ?? null,
    tagline: org.tagline ?? null,
    states: org.states ?? [],
    serves: org.serves ?? [],
  }
}

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
 *
 * When FF_NONPROFIT_PARITY_V1 is on, the response also carries `orgs`: the
 * published pilot-partner records (`partner_org`), serialised through the
 * allow-list above. Off, the response is byte-identical to before the flag
 * existed — the key is absent, not empty.
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

  const body: {
    partners: typeof partners
    count: number
    kinds: typeof PARTNER_KINDS
    serves: typeof PARTNER_SERVES
    orgs?: PublicPartnerOrg[]
  } = {
    partners,
    count: partners.length,
    kinds: PARTNER_KINDS,
    serves: PARTNER_SERVES,
  }

  if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
    const published = await directory.listPublishedOrgs()
    body.orgs = published.map(toPublicPartnerOrg)
  }

  return res.status(200).json(body)
}
