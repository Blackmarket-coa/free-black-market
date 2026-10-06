import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

/**
 * Customer metadata keys only the server may write.
 *
 * `blackout_user_id` and `mxid` are identity keys: the Blackout hosted
 * checkout resolves its buyer through them (`resolveOrCreateCustomerForBlackoutUser`,
 * lib/blackout-identity.ts), the manage session binds a member to the
 * customer carrying `blackout_user_id`, and grants, webhooks and the hawala /
 * entitlement readers trust `mxid`. `mxid_source` says whether `mxid` came
 * from the IdP ("oidc") or was derived ("derived"); a client that could set
 * it could claim either.
 *
 * Medusa core's StoreCreateCustomer / StoreUpdateCustomer accept a free-form
 * `metadata` record, and the customer module MERGES it into the stored
 * metadata (`mergeMetadata`; a "" value deletes the key). Left open, a
 * storefront customer could set `metadata.mxid` to another person's Matrix id
 * — the checkout's mxid fallback would then adopt that customer for them —
 * or set `metadata.blackout_user_id` directly, or delete their own link.
 *
 * Server writers are unaffected: the `customer.created` Matrix subscriber, the
 * Blackout checkout and `POST /v1/integrations/blackout/link` write through
 * the customer module or SQL, never through these routes.
 */
export const SERVER_OWNED_CUSTOMER_METADATA_KEYS = ["blackout_user_id", "mxid", "mxid_source"] as const

function reservedKeysIn(body: unknown): string[] {
  if (!body || typeof body !== "object") return []
  const metadata = (body as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return []
  return SERVER_OWNED_CUSTOMER_METADATA_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(metadata, key))
}

/**
 * Refuses a storefront customer create / update whose `metadata` names any
 * server-owned key, with any value (setting, overwriting and deleting are all
 * writes). 400 invalid_data, nothing written. Checks the raw body and, when a
 * validator has already run, `validatedBody` too, so it holds whichever side
 * of Medusa's own body validation it is ordered on.
 *
 * Refused rather than stripped: a stripped request would report success for a
 * write that did not happen. No first-party client sends these keys
 * (storefront/src/lib/data/customer.ts sends names and phone only).
 */
export function refuseServerOwnedCustomerMetadata(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const validated = (req as MedusaRequest & { validatedBody?: unknown }).validatedBody
  const keys = [...new Set([...reservedKeysIn(req.body), ...reservedKeysIn(validated)])]
  if (keys.length > 0) {
    res.status(400).json({
      type: "invalid_data",
      message: `metadata.${keys[0]} cannot be set from the store API.`,
    })
    return
  }
  next()
}
