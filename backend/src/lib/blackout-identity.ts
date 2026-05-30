import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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

/** Resolve a customer's Matrix MXID from `customer.metadata.mxid`. */
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
