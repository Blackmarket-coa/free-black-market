import type { InferTypeOf } from "@medusajs/framework/types"
import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import { getPartner, listPartners, partnerLinks } from "./catalog"
import { PartnerOrg } from "./models"
import {
  normaliseEin,
  PARTNER_ORG_VERIFICATION_FIELDS,
  publishRefusal,
  type PartnerOrgRelationship,
  type PartnerOrgType,
} from "./org-types"
import type { PartnerEntry, PartnerFilters } from "./types"

export type PartnerOrgRecord = InferTypeOf<typeof PartnerOrg>

/**
 * The columns an operator may write. Verification columns are not here on
 * purpose: `PARTNER_ORG_VERIFICATION_FIELDS` are the ingest's to write.
 */
export type PartnerOrgWritable = {
  name?: string
  org_type?: PartnerOrgType | null
  ein?: string | null
  relationship?: PartnerOrgRelationship
  fiscal_host_key?: string | null
  stripe_connect_account_id?: string | null
  published?: boolean
  url?: string | null
  tagline?: string | null
  states?: string[]
  serves?: string[]
  metadata?: Record<string, unknown> | null
}

export type CreatePartnerOrgInput = PartnerOrgWritable & { key: string; name: string }

export type PartnerOrgWriteOptions = {
  /** Per-request acknowledgement for publishing a coop / unincorporated org. */
  publish_unverified_ack?: boolean
}

/** Thrown when `published: true` is refused; `code` is the `PublishRefusalCode`. */
export const PUBLISH_REFUSED = "partner_org_publish_refused"

const KEY_PATTERN = /^[a-z0-9][a-z0-9_]{1,63}$/

/** The DML types a JSON column as a record; these two hold arrays. One cast, here. */
type JsonColumn = Record<string, unknown>
type PersistedWrite<T extends PartnerOrgWritable> = Omit<T, "states" | "serves"> & {
  states?: JsonColumn
  serves?: JsonColumn
}

function toPersisted<T extends PartnerOrgWritable>(data: T): PersistedWrite<T> {
  const { states, serves, ...rest } = data
  const out: PersistedWrite<T> = { ...rest }
  if (states !== undefined) out.states = states as unknown as JsonColumn
  if (serves !== undefined) out.serves = serves as unknown as JsonColumn
  return out
}

/**
 * Partner directory module service.
 *
 * Two things live behind one key. The refer-out *catalog* is still code
 * (`catalog.ts`; `list/get/links` below are its unchanged contract, and
 * `fiscal-sponsorship-readiness.ts` / `progressions.ts` keep importing
 * `partnerLinks` directly). The *partner_org* table is new: pilot-partner
 * records with an EIN, ingest-written verification and a direct-charge
 * destination, default-unpublished (docs/BMC_SURVIVAL_PROGRAMS.md Phase 1).
 *
 * The two guards that matter sit here, not in a route or a workflow hook, for
 * the reason `hawala-ledger/posture-a-guard.ts` gives: the service layer is
 * the only place that can reliably refuse to write.
 *
 * 1. Verification columns are stripped from every operator write.
 * 2. A write that leaves a row published must pass `publishRefusal`.
 */
class PartnerDirectoryModuleService extends MedusaService({ PartnerOrg }) {
  // ── Refer-out catalog (unchanged contract) ──────────────────────────────

  list(filters: PartnerFilters = {}): PartnerEntry[] {
    return listPartners(filters)
  }

  get(key: string): PartnerEntry | null {
    return getPartner(key)
  }

  /** Gatekeeper links for a quest definition: `{ label, url }` in directory order. */
  links(filters: PartnerFilters = {}): { label: string; url: string }[] {
    return partnerLinks(filters)
  }

  // ── partner_org ─────────────────────────────────────────────────────────

  /** Rows the public may see. Callers still gate on FF_NONPROFIT_PARITY_V1. */
  async listPublishedOrgs(): Promise<PartnerOrgRecord[]> {
    return this.listPartnerOrgs({ published: true })
  }

  async getOrgByKey(key: string): Promise<PartnerOrgRecord | null> {
    const [row] = await this.listPartnerOrgs({ key })
    return row ?? null
  }

  /**
   * Create a partner org. Verification fields in `input` are dropped, the
   * EIN is normalised, and `published: true` must pass the publish guard.
   */
  async createOrg(input: CreatePartnerOrgInput, opts: PartnerOrgWriteOptions = {}): Promise<PartnerOrgRecord> {
    const data = this.sanitiseWrite(input) as CreatePartnerOrgInput

    if (typeof data.key !== "string" || !KEY_PATTERN.test(data.key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "key must be 2-64 lowercase letters, digits or underscores"
      )
    }
    if (typeof data.name !== "string" || data.name.trim().length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required")
    }

    if ((await this.getOrgByKey(data.key)) !== null) {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, `A partner org with key ${data.key} already exists`)
    }

    await this.assertFiscalHost(data.key, data.fiscal_host_key)

    // Always hand the DML a fresh array. `model.json().default(...)` assigns
    // its default value by reference, so two rows created without `states`
    // would otherwise share one array object in memory.
    data.states = [...(data.states ?? [])]
    data.serves = [...(data.serves ?? [])]

    if (data.published === true) {
      this.assertPublishable(
        { org_type: data.org_type ?? null, verification_status: "unverified" },
        opts
      )
    }

    const created = await this.createPartnerOrgs(toPersisted(data))
    return Array.isArray(created) ? created[0] : created
  }

  /**
   * Patch a partner org by key. Only the fields present in `patch` change;
   * verification fields are dropped. The publish guard runs whenever the
   * resulting row would be published and the patch touched `published` or
   * `org_type` — the two inputs the guard depends on that an operator can set.
   */
  async updateOrg(
    key: string,
    patch: PartnerOrgWritable,
    opts: PartnerOrgWriteOptions = {}
  ): Promise<PartnerOrgRecord> {
    const existing = await this.getOrgByKey(key)
    if (!existing) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner org ${key} not found`)
    }

    const data = this.sanitiseWrite(patch)
    if ("key" in data) delete (data as Record<string, unknown>).key

    if (data.fiscal_host_key !== undefined) {
      await this.assertFiscalHost(key, data.fiscal_host_key)
    }

    const willBePublished = data.published ?? existing.published
    if (willBePublished && ("published" in data || "org_type" in data)) {
      this.assertPublishable(
        {
          org_type: (data.org_type !== undefined ? data.org_type : existing.org_type) ?? null,
          verification_status: existing.verification_status,
        },
        opts
      )
    }

    const updated = await this.updatePartnerOrgs({ id: existing.id, ...toPersisted(data) })
    return Array.isArray(updated) ? updated[0] : updated
  }

  // ── guards ──────────────────────────────────────────────────────────────

  /** Drop ingest-only columns; normalise the EIN; copy so the caller's object is untouched. */
  private sanitiseWrite<T extends PartnerOrgWritable>(input: T): T {
    const data: Record<string, unknown> = { ...input }
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      delete data[field]
    }
    if ("ein" in data && data.ein !== undefined) {
      if (data.ein === null) {
        data.ein = null
      } else {
        const ein = normaliseEin(String(data.ein))
        if (ein === null) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "ein must be nine digits (12-3456789 or 123456789)")
        }
        data.ein = ein
      }
    }
    return data as T
  }

  private assertPublishable(
    org: Parameters<typeof publishRefusal>[0],
    opts: PartnerOrgWriteOptions
  ): void {
    const refusal = publishRefusal(org, opts)
    if (refusal) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, refusal.message, refusal.code)
    }
  }

  /** A fiscal host must be another existing org, named by key. */
  private async assertFiscalHost(ownKey: string, hostKey: string | null | undefined): Promise<void> {
    if (hostKey === null || hostKey === undefined) return
    if (hostKey === ownKey) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "fiscal_host_key cannot point at the org itself")
    }
    if ((await this.getOrgByKey(hostKey)) === null) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `fiscal_host_key ${hostKey} does not name an existing partner org`)
    }
  }
}

export default PartnerDirectoryModuleService
