import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import {
  bearerToken,
  isBlackoutIntegrationEnabled,
  verifyEntitlementsServiceToken,
} from "../../../../../lib/blackout-oauth"
import { resolveOrCreateCustomerForBlackoutUser } from "../../../../../lib/blackout-identity"
import { forbidden } from "../../../../../shared/community-read-access"

/**
 * Account-link capture (Workstream B).
 *
 * Blackout calls this once a user links their Blackout account to FBM, handing
 * us the Blackout user id (`sub`) to store against the matching FBM customer
 * and/or seller. That stored id becomes the `userId` on every outbound webhook
 * and the key Blackout's entitlement grants resolve against.
 *
 * Auth: the entitlements service token (or a valid Blackout JWT). Target is
 * identified by explicit ids or by mxid.
 *
 * A customer already carrying a different `metadata.blackout_user_id`, or a
 * seller whose `seller_metadata.blackout_user_id` names a different member,
 * is never re-linked: 403 forbidden(). When either is seen on the read,
 * nothing is written. The two conditional UPDATEs are not one transaction:
 * if the customer's commits and the seller's then loses a race to another
 * member's link, the 403 leaves the customer half linked (to the caller's
 * own id — never over someone else's).
 */

const BodySchema = z
  .object({
    blackoutUserId: z.string().min(1).max(256),
    mxid: z.string().min(1).max(256).optional(),
    customerId: z.string().min(1).max(80).optional(),
    sellerId: z.string().min(1).max(80).optional(),
  })
  .strict()
  .refine((d) => !!(d.mxid || d.customerId || d.sellerId), {
    message: "one of mxid, customerId, or sellerId is required",
  })

type PgConnection = {
  raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>>; rowCount?: number }>
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) {
    return res
      .status(503)
      .json({ code: "service_disabled", message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
  }

  const token = bearerToken(req)
  if (!token || !verifyEntitlementsServiceToken(token)) {
    return res.status(401).json({ code: "unauthorized", message: "Invalid or missing service token" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid link payload",
      details: parsed.error.flatten(),
    })
  }
  const { blackoutUserId, mxid, customerId, sellerId } = parsed.data

  const conn = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgConnection
  const linked: { customer?: string; seller?: string } = {}

  // Customer: explicit id, else resolve by mxid. Several customers can share
  // an mxid (the checkout provisions a member their own customer when the
  // mxid's customer is linked to someone else), so the pick is ordered, never
  // "whichever row Postgres returns": one carrying this member's id or none
  // first, then the lowest id. Another member's customer is only picked —
  // and then refused below — when every match is another member's.
  let targetCustomerId = customerId ?? null
  if (!targetCustomerId && mxid) {
    const r = await conn.raw(
      `SELECT id FROM customer WHERE metadata->>'mxid' = ? AND deleted_at IS NULL
        ORDER BY (COALESCE(metadata->>'blackout_user_id', '') IN ('', ?)) DESC, id
        LIMIT 1`,
      [mxid, blackoutUserId]
    )
    const id = r?.rows?.[0]?.id
    if (typeof id === "string") targetCustomerId = id
  }

  // Seller: explicit id, else resolve by mxid.
  let targetSellerId = sellerId ?? null
  if (!targetSellerId && mxid) {
    const r = await conn.raw(
      `SELECT seller_id FROM seller_metadata WHERE mxid = ? AND deleted_at IS NULL LIMIT 1`,
      [mxid]
    )
    const id = r?.rows?.[0]?.seller_id
    if (typeof id === "string") targetSellerId = id
  }

  // Never move a customer or a seller from one Blackout member to another.
  // A target already linked to a DIFFERENT Blackout id is refused before
  // anything is written (both halves are read first): overwriting it would
  // hand that member's subscriptions, grants, payouts and webhooks to the
  // caller's id. The same id again, or no id yet, links as before. One
  // forbidden() body, so the answer says nothing about whose record it was.
  const linkedToSomeoneElse = (id: unknown): boolean =>
    typeof id === "string" && id.length > 0 && id !== blackoutUserId

  let customerRow: Record<string, unknown> | undefined
  if (targetCustomerId) {
    const current = await conn.raw(
      `SELECT metadata->>'blackout_user_id' AS blackout_user_id
         FROM customer WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [targetCustomerId]
    )
    customerRow = current?.rows?.[0]
    if (linkedToSomeoneElse(customerRow?.blackout_user_id)) {
      forbidden(res)
      return
    }
  }
  let sellerRow: Record<string, unknown> | undefined
  if (targetSellerId) {
    const current = await conn.raw(
      `SELECT blackout_user_id FROM seller_metadata
         WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [targetSellerId]
    )
    sellerRow = current?.rows?.[0]
    if (linkedToSomeoneElse(sellerRow?.blackout_user_id)) {
      forbidden(res)
      return
    }
  }

  // Each WHERE repeats its check so a concurrent link to someone else cannot
  // be overwritten between the read and the write.
  if (targetCustomerId) {
    const updated = await conn.raw(
      `UPDATE customer
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('blackout_user_id', ?::text),
             updated_at = now()
       WHERE id = ? AND deleted_at IS NULL
         AND (COALESCE(metadata->>'blackout_user_id', '') IN ('', ?))`,
      [blackoutUserId, targetCustomerId, blackoutUserId]
    )
    if (customerRow && updated?.rowCount === 0) {
      forbidden(res)
      return
    }
    linked.customer = targetCustomerId
  }

  if (targetSellerId) {
    const updated = await conn.raw(
      `UPDATE seller_metadata
         SET blackout_user_id = ?, updated_at = now()
       WHERE seller_id = ? AND deleted_at IS NULL
         AND (COALESCE(blackout_user_id, '') IN ('', ?))`,
      [blackoutUserId, targetSellerId, blackoutUserId]
    )
    if (sellerRow && updated?.rowCount === 0) {
      forbidden(res)
      return
    }
    linked.seller = targetSellerId
  }

  // Create-on-miss (W1b): a Blackout-native member with no FBM account yet
  // still needs a customer to own carts/orders/subscriptions, so a link call
  // that matches nothing provisions one (metadata-keyed, synthetic email)
  // instead of 404ing. Sellers are never auto-created — vendor onboarding is
  // an explicit flow.
  let createdCustomer = false
  if (!linked.customer && !linked.seller && !sellerId) {
    const resolved = await resolveOrCreateCustomerForBlackoutUser(req.scope, {
      blackoutUserId,
      mxid,
    })
    if (resolved) {
      linked.customer = resolved.customerId
      createdCustomer = resolved.created
    }
  }

  if (!linked.customer && !linked.seller) {
    return res.status(404).json({
      code: "not_found",
      message: "No customer or seller matched the supplied identifier(s)",
    })
  }

  return res.json({ ok: true, blackoutUserId, linked, created: createdCustomer })
}
