import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { eraseCustomerAcrossRegistry } from "../../../../../lib/customer-erasure"

const log = createLogger("api/store/customers/me/deletion")

/**
 * POST /store/customers/me/deletion  (authenticated customer)
 *
 * CCPA/CPRA "right to delete". Erases the customer's personal data:
 *  - removes saved addresses,
 *  - anonymises the customer record (email / name / phone / company),
 *  - revokes the auth identity so the account can no longer sign in.
 *
 * Completed-order records are retained in anonymised form (unlinked from live
 * PII) under the tax/accounting legal-basis exception both CCPA and GDPR allow.
 * Scoped strictly to the authenticated actor; the id is never taken from the
 * request body.
 *
 * Each destructive step is best-effort and independently guarded so a failure
 * in one does not strand the others — the anonymisation of the customer record
 * is the load-bearing step and runs regardless of the address/auth outcomes.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const authContext = (req as any).auth_context as
    | { actor_id?: string; auth_identity_id?: string }
    | undefined
  const customerId = authContext?.actor_id
  const authIdentityId = authContext?.auth_identity_id

  if (!customerId || !customerId.startsWith("cus_")) {
    return res
      .status(401)
      .json({ message: "Customer authentication required", type: "unauthorized" })
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  const query = req.scope.resolve("query")

  // 1) Remove saved addresses (best-effort).
  let addressesRemoved = 0
  try {
    const { data: addresses } = await query.graph({
      entity: "customer_address",
      fields: ["id"],
      filters: { customer_id: customerId } as any,
    })
    const ids = (addresses ?? []).map((a: any) => a.id).filter(Boolean)
    if (ids.length) {
      await (customerModule as any).deleteCustomerAddresses(ids)
      addressesRemoved = ids.length
    }
  } catch (err) {
    log.warn(
      `deletion: address removal failed for ${customerId}: ${(err as Error).message}`
    )
  }

  // 2) Anonymise the customer record (load-bearing step).
  await customerModule.updateCustomers(customerId, {
    email: `deleted-${customerId}@deleted.invalid`,
    first_name: null,
    last_name: null,
    phone: null,
    company_name: null,
    metadata: {
      deleted_at: new Date().toISOString(),
      deletion_reason: "customer_self_service",
    },
  } as any)

  // 3) Apply the customer-data registry across every other module (D11-1).
  //
  // Before this, deletion touched addresses, the customer record and the auth
  // identity, and nothing else — while 47 tables carried a `customer_id`. A
  // past delivery kept the recipient's name, phone and street address;
  // volunteer attendance, garden membership, ledger balances, governance votes
  // and wellness records all survived. `lib/customer-data-registry.ts` decides
  // what happens to each, and a test fails the build when a model gains a
  // `customer_id` without an entry, so this cannot silently fall behind again.
  const registryResults = await eraseCustomerAcrossRegistry(req.scope, customerId)
  const registryFailures = registryResults.filter((r) => r.error)
  const registryRows = registryResults.reduce((sum, r) => sum + r.rows, 0)

  // 4) Revoke the auth identity so the account can no longer sign in (best-effort).
  let loginRevoked = false
  try {
    if (authIdentityId) {
      const authModule = req.scope.resolve(Modules.AUTH)
      await (authModule as any).deleteAuthIdentities([authIdentityId])
      loginRevoked = true
    }
  } catch (err) {
    log.warn(
      `deletion: auth-identity revocation failed for ${customerId}: ${(err as Error).message}`
    )
  }

  log.info(
    `account deletion processed for ${customerId} (addresses removed: ${addressesRemoved}, ` +
      `login revoked: ${loginRevoked}, registry rows affected: ${registryRows}, ` +
      `registry failures: ${registryFailures.length})`
  )
  if (registryFailures.length > 0) {
    // Surfaced as an operator problem rather than swallowed: a partial erasure
    // is exactly what the person was told would not happen.
    log.warn(
      `deletion: ${registryFailures.length} entities could not be erased for ` +
        `${customerId}: ${registryFailures.map((f) => `${f.entity} (${f.error})`).join("; ")}`
    )
  }

  res.status(200).json({
    deleted: true,
    customer_id: customerId,
    addresses_removed: addressesRemoved,
    login_revoked: loginRevoked,
    records_erased: registryRows,
    // Named rather than counted: a person told their data was deleted should be
    // able to see which parts were not.
    entities_failed: registryFailures.map((f) => f.entity),
    note:
      "Your personal data has been erased. Completed-order records are retained in " +
      "anonymised form under a tax/accounting legal-basis exception.",
  })
}
