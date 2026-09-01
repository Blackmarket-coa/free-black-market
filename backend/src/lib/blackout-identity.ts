import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Identity resolution for the Blackout integration.
 *
 * The webhook `userId` is the Blackout OAuth `sub` captured at account-link
 * time — NOT the Matrix `mxid`. It is stored in:
 *   - `customer.metadata.blackout_user_id` for buyers, and
 *   - `seller_metadata.blackout_user_id` for vendors.
 *
 * Emit points call `resolveBlackoutUserId` and SKIP the event when it returns
 * null rather than ever putting an mxid/email/PII in the `userId` slot.
 *
 * `vendorMxid` (for §3 bridge events) is resolved separately from
 * `seller_metadata.mxid`.
 *
 * W2 note: `customer.metadata.mxid` now also carries `mxid_source`
 * ("oidc" = reported by the MAS IdP via the `mas` auth provider,
 * "derived" = legacy email-local-part provisioning). Precedence rules live
 * in `lib/oidc-mxid.ts`; consumers of `metadata.mxid` need no change.
 */

type PgConnection = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

function pg(container: MedusaContainer): PgConnection | null {
  try {
    return container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgConnection
  } catch {
    return null
  }
}

function firstString(
  rows: Array<Record<string, unknown>> | undefined,
  column: string
): string | null {
  const v = rows?.[0]?.[column]
  return typeof v === "string" && v.length > 0 ? v : null
}

export interface ResolveUserIdArgs {
  customerId?: string | null
  sellerId?: string | null
  /** Order metadata, used for the `fbm_external_customer_id` legacy link. */
  orderMetadata?: Record<string, unknown> | null
}

/**
 * Resolve the Blackout user id for an actor, trying (in order): the customer's
 * stored `blackout_user_id`, the seller's stored `blackout_user_id`, then the
 * order's `fbm_external_customer_id` link. Returns null when none is present —
 * the caller MUST skip emitting rather than leak a non-Blackout identifier.
 */
export async function resolveBlackoutUserId(
  container: MedusaContainer,
  args: ResolveUserIdArgs
): Promise<string | null> {
  const conn = pg(container)

  if (conn && args.customerId) {
    try {
      const res = await conn.raw(
        `SELECT metadata->>'blackout_user_id' AS blackout_user_id
           FROM customer WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [args.customerId]
      )
      const id = firstString(res?.rows, "blackout_user_id")
      if (id) return id
    } catch {
      // customer table not in scope / not migrated; fall through
    }
  }

  if (conn && args.sellerId) {
    const id = await resolveSellerBlackoutUserId(container, args.sellerId)
    if (id) return id
  }

  const legacy = args.orderMetadata?.["fbm_external_customer_id"]
  if (typeof legacy === "string" && legacy.length > 0) return legacy

  return null
}

/** Resolve a vendor's Blackout user id from `seller_metadata`. */
export async function resolveSellerBlackoutUserId(
  container: MedusaContainer,
  sellerId: string
): Promise<string | null> {
  const conn = pg(container)
  if (!conn) return null
  try {
    const res = await conn.raw(
      `SELECT blackout_user_id FROM seller_metadata
         WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sellerId]
    )
    return firstString(res?.rows, "blackout_user_id")
  } catch {
    return null
  }
}

/** Forward lookup: Blackout user id -> FBM seller_id (for §5 seller calls). */
export async function resolveSellerIdByBlackoutUserId(
  container: MedusaContainer,
  blackoutUserId: string
): Promise<string | null> {
  const conn = pg(container)
  if (!conn) return null
  try {
    const res = await conn.raw(
      `SELECT seller_id FROM seller_metadata
         WHERE blackout_user_id = ? AND deleted_at IS NULL LIMIT 1`,
      [blackoutUserId]
    )
    return firstString(res?.rows, "seller_id")
  } catch {
    return null
  }
}

/** Resolve a vendor's Matrix MXID (for §3 `vendorMxid`) from `seller_metadata`. */
export async function resolveSellerMxid(
  container: MedusaContainer,
  sellerId: string
): Promise<string | null> {
  const conn = pg(container)
  if (!conn) return null
  try {
    const res = await conn.raw(
      `SELECT mxid FROM seller_metadata
         WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sellerId]
    )
    return firstString(res?.rows, "mxid")
  } catch {
    return null
  }
}

/**
 * Find — or create — the Medusa customer backing a Blackout user (W1b).
 *
 * A Blackout-native member who never registered on FBM still needs to own a
 * cart, an order, a subscription, and a saved payment method, so the billing
 * path cannot 404 on "no customer". Resolution order: stored
 * `metadata.blackout_user_id`, then `metadata.mxid`, then create a customer
 * carrying both keys. A created customer gets a deterministic placeholder
 * email (`blackout+<sub>@users.blackout.invalid`, flagged
 * `metadata.synthetic_email`) so nothing routes real mail to it; a later
 * account link can overwrite it with a real address.
 */
export async function resolveOrCreateCustomerForBlackoutUser(
  container: MedusaContainer,
  args: { blackoutUserId: string; mxid?: string | null }
): Promise<{ customerId: string; created: boolean } | null> {
  const conn = pg(container)
  if (!conn) return null

  const findBy = async (key: string, value: string): Promise<string | null> => {
    try {
      const res = await conn.raw(
        `SELECT id FROM customer WHERE metadata->>'${key}' = ? AND deleted_at IS NULL LIMIT 1`,
        [value]
      )
      return firstString(res?.rows, "id")
    } catch {
      return null
    }
  }

  const patchMetadata = async (customerId: string): Promise<void> => {
    const patch: Record<string, string> = { blackout_user_id: args.blackoutUserId }
    if (args.mxid) patch.mxid = args.mxid
    try {
      await conn.raw(
        `UPDATE customer
           SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb,
               updated_at = now()
         WHERE id = ? AND deleted_at IS NULL`,
        [JSON.stringify(patch), customerId]
      )
    } catch {
      // metadata patch is best-effort; the customer itself is the requirement
    }
  }

  const existingById = await findBy("blackout_user_id", args.blackoutUserId)
  if (existingById) {
    if (args.mxid) await patchMetadata(existingById)
    return { customerId: existingById, created: false }
  }

  if (args.mxid) {
    const existingByMxid = await findBy("mxid", args.mxid)
    if (existingByMxid) {
      await patchMetadata(existingByMxid)
      return { customerId: existingByMxid, created: false }
    }
  }

  try {
    const customerService = container.resolve(Modules.CUSTOMER) as unknown as {
      createCustomers: (
        d: Record<string, unknown>
      ) => Promise<{ id: string } | Array<{ id: string }>>
    }
    const created = await customerService.createCustomers({
      email: `blackout+${sanitizeForEmail(args.blackoutUserId)}@users.blackout.invalid`,
      metadata: {
        blackout_user_id: args.blackoutUserId,
        ...(args.mxid ? { mxid: args.mxid } : {}),
        synthetic_email: true,
      },
    })
    const customerId = Array.isArray(created) ? created[0]?.id : created.id
    return customerId ? { customerId, created: true } : null
  } catch {
    return null
  }
}

function sanitizeForEmail(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]/g, "-")
  return cleaned.slice(0, 64) || "user"
}

/** Resolve a customer's Matrix MXID from `customer.metadata.mxid`. */
/**
 * Resolve a seller from an mxid.
 *
 * Deliberately keyed on `mxid` rather than `blackout_user_id`, which the
 * sibling `resolveSellerIdByBlackoutUserId` uses. `seller_metadata.mxid`
 * carries a partial-unique index; `blackout_user_id` is only indexed, so two
 * seller rows can share it. Joining an anti-self-dealing check on the
 * non-unique column would hand an attacker a split-identity bypass: register a
 * second seller with the same Blackout account and the comparison stops
 * matching.
 */
export async function resolveSellerIdByMxid(
  container: MedusaContainer,
  mxid: string
): Promise<string | null> {
  const conn = pg(container)
  if (!conn) return null
  try {
    const res = await conn.raw(
      `SELECT seller_id FROM seller_metadata
         WHERE mxid = ? AND deleted_at IS NULL LIMIT 1`,
      [mxid]
    )
    return firstString(res?.rows, "seller_id")
  } catch {
    return null
  }
}

export async function resolveCustomerMxid(
  container: MedusaContainer,
  customerId: string
): Promise<string | null> {
  const conn = pg(container)
  if (!conn) return null
  try {
    const res = await conn.raw(
      `SELECT metadata->>'mxid' AS mxid
         FROM customer WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [customerId]
    )
    return firstString(res?.rows, "mxid")
  } catch {
    return null
  }
}
