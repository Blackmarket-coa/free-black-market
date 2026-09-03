import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { DOCUMENT_VAULT_MODULE } from "../../../../modules/document-vault"
import type DocumentVaultModuleService from "../../../../modules/document-vault/service"
import { effectiveDocumentStatus } from "../../../../modules/document-vault/document-status"

const log = createLogger("api/admin/vault/[id]")

const getAdminId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id ?? "admin"

/**
 * PATCH /admin/vault/:id — record a human check.
 *
 * The first caller `markVerified` has ever had. The service method has
 * existed since the module shipped, correct and unreachable: no admin route,
 * no workflow, no subscriber. `verified` was written once, as false, by the
 * vendor upload route and never again — so the compliance-tracker quest's
 * "Documented" and "Certification-Ready" gates could never unlock, and the
 * wellness-insurance packet's credential section was permanently empty.
 *
 * `verified: true` is a statement that a person looked. It is refused on a
 * document whose `expires_at` has already passed: verifying an expired
 * certificate would put a `verified: true` on the row for a coverage window
 * that is over, which is the exact "expired but still shows verified" shape
 * this module's docblock says must never exist. Re-issue the document instead.
 *
 * `verified: false` withdraws a check. Recorded with who and why in metadata
 * rather than by deleting `verified_at` — the fact that a check was made and
 * then withdrawn is part of the record.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as { verified?: unknown; note?: unknown }
  if (typeof body.verified !== "boolean") {
    return res.status(400).json({ message: "verified must be true or false" })
  }
  const note = typeof body.note === "string" ? body.note.trim() : ""

  const service = req.scope.resolve<DocumentVaultModuleService>(
    DOCUMENT_VAULT_MODULE
  )
  const [doc] = (await service.listVaultDocuments({ id })) as unknown as {
    id: string
    verified: boolean
    verified_at: Date | null
    expires_at: Date | null
    metadata: Record<string, unknown> | null
  }[]
  if (!doc) return res.status(404).json({ message: "Document not found" })

  const now = new Date()
  const adminId = getAdminId(req)

  try {
    if (body.verified) {
      if (effectiveDocumentStatus({ ...doc, verified: true }, now) === "expired") {
        return res.status(409).json({
          message:
            "This document's expiry date has already passed. Verifying it would record a check on a coverage window that is over — ask the vendor for a current one.",
          type: "expired",
        })
      }
      await service.markVerified(id, now)
      await service.updateVaultDocuments({
        id,
        metadata: {
          ...(doc.metadata ?? {}),
          verified_by: adminId,
          ...(note ? { verification_note: note } : {}),
        },
      })
    } else {
      await service.updateVaultDocuments({
        id,
        verified: false,
        metadata: {
          ...(doc.metadata ?? {}),
          verification_withdrawn_at: now.toISOString(),
          verification_withdrawn_by: adminId,
          ...(note ? { verification_withdrawn_note: note } : {}),
        },
      })
    }

    const [updated] = (await service.listVaultDocuments({ id })) as unknown as {
      verified: boolean
      verified_at: Date | null
      expires_at: Date | null
    }[]
    return res.json({
      document: {
        ...updated,
        effective_status: effectiveDocumentStatus(updated, now),
      },
    })
  } catch (err) {
    log.error(`[PATCH /admin/vault/:id] ${id}`, err)
    return res.status(500).json({ message: "Failed to update document" })
  }
}
