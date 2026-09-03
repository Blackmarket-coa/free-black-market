import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DOCUMENT_VAULT_MODULE } from "../../../modules/document-vault"
import type DocumentVaultModuleService from "../../../modules/document-vault/service"
import {
  daysUntilExpiry,
  effectiveDocumentStatus,
} from "../../../modules/document-vault/document-status"

/**
 * GET /admin/vault — the verification queue.
 *
 * Defaults to unverified documents, oldest first: the ones a vendor is
 * waiting on. `verified=true` shows the checked ones, and `expiring_within`
 * (days) narrows either to documents whose coverage closes soon — the list an
 * admin works before a certificate lapses rather than after.
 *
 * Every row carries `effective_status` and `days_until_expiry` computed at
 * request time. `verified` is the stored fact; `effective_status` is what it
 * currently proves.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DocumentVaultModuleService>(
    DOCUMENT_VAULT_MODULE
  )

  const filters: Record<string, unknown> = {}
  if (typeof req.query.seller_id === "string") filters.seller_id = req.query.seller_id
  if (typeof req.query.doc_type === "string") filters.doc_type = req.query.doc_type
  const verifiedParam =
    typeof req.query.verified === "string" ? req.query.verified : "false"
  if (verifiedParam !== "all") filters.verified = verifiedParam === "true"

  const rows = (await service.listVaultDocuments(filters, {
    order: { created_at: "ASC" },
  })) as unknown as {
    id: string
    verified: boolean
    verified_at: Date | null
    expires_at: Date | null
  }[]

  const now = new Date()
  const within = Number(req.query.expiring_within)

  const documents = rows
    .map((doc) => ({
      ...doc,
      effective_status: effectiveDocumentStatus(doc, now),
      days_until_expiry: daysUntilExpiry(doc, now),
    }))
    .filter((doc) =>
      Number.isFinite(within)
        ? doc.days_until_expiry !== null && doc.days_until_expiry <= within
        : true
    )

  return res.json({ documents, count: documents.length, as_of: now })
}
