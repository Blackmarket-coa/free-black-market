import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import {
  bearerToken,
  isBlackoutIntegrationEnabled,
  verifyEntitlementsServiceToken,
} from "../../../../../lib/blackout-oauth"

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

  // Customer: explicit id, else resolve by mxid.
  let targetCustomerId = customerId ?? null
  if (!targetCustomerId && mxid) {
    const r = await conn.raw(
      `SELECT id FROM customer WHERE metadata->>'mxid' = ? AND deleted_at IS NULL LIMIT 1`,
      [mxid]
    )
    const id = r?.rows?.[0]?.id
    if (typeof id === "string") targetCustomerId = id
  }
  if (targetCustomerId) {
    await conn.raw(
      `UPDATE customer
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('blackout_user_id', ?::text),
             updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
      [blackoutUserId, targetCustomerId]
    )
    linked.customer = targetCustomerId
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
  if (targetSellerId) {
    await conn.raw(
      `UPDATE seller_metadata
         SET blackout_user_id = ?, updated_at = now()
       WHERE seller_id = ? AND deleted_at IS NULL`,
      [blackoutUserId, targetSellerId]
    )
    linked.seller = targetSellerId
  }

  if (!linked.customer && !linked.seller) {
    return res.status(404).json({
      code: "not_found",
      message: "No customer or seller matched the supplied identifier(s)",
    })
  }

  return res.json({ ok: true, blackoutUserId, linked })
}
