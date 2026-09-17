import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../modules/seller-extension/metadata-service"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../modules/blackstar-fulfillment"
import type BlackstarFulfillmentService from "../../../modules/blackstar-fulfillment/service"
import { provisionNodeOperator } from "../../../shared/provision-node-operator"

const log = createLogger("api/vendor/node-operator")

type MetaRow = {
  id: string
  vendor_type: string | null
  node_operator_opt_in: boolean | null
}

type SellerRow = { id: string; name: string | null }

async function loadContext(req: AuthenticatedMedusaRequest, sellerId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "name"],
    filters: { id: sellerId },
  })

  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "vendor_type", "node_operator_opt_in"],
    filters: { seller_id: sellerId },
  })

  // Blackstar stands the node up against a person, not a storefront, so the
  // owning member is part of the payload. `member` is not exposed through
  // the module graph, hence the raw read.
  let member: { name: string | null; email: string | null } | null = null
  try {
    const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
      raw: (
        sql: string,
        params: unknown[]
      ) => Promise<{ rows?: Array<{ name: string | null; email: string | null }> }>
    }
    const result = await pg.raw(
      `SELECT name, email FROM member WHERE seller_id = ? ORDER BY created_at ASC LIMIT 1`,
      [sellerId]
    )
    member = result.rows?.[0] ?? null
  } catch (error) {
    log.warn(
      `[node-operator] Could not load the owning member for ${sellerId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return {
    seller: (sellers?.[0] as SellerRow | undefined) ?? null,
    meta: (metaRows?.[0] as MetaRow | undefined) ?? null,
    member,
  }
}

/**
 * GET /vendor/node-operator
 *
 * Whether this seller runs a Blackstar logistics node, and the key id of the
 * credential it signs with. Never the secret: that is shown once at issue and
 * stored encrypted with no read-back path, so an operator who loses it rotates
 * rather than recovers.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const { meta } = await loadContext(req, sellerId)
  const blackstar = req.scope.resolve<BlackstarFulfillmentService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )
  const credential = await blackstar.getNodeOperatorCredential(sellerId)

  return res.json({
    node_operator: {
      opted_in: meta?.node_operator_opt_in === true,
      credential,
    },
  })
}

/**
 * POST /vendor/node-operator  { opted_in: boolean }
 *
 * The "or afterwards" path: a seller who did not opt in during the onboarding
 * survey can turn this on later, and turn it off again.
 *
 * Turning it ON issues a fresh credential and tells Blackstar to stand up the
 * node, returning the secret exactly once. Re-issuing on a seller who is
 * already on revokes the previous credential first, so the answer to "I lost my
 * secret" is this button rather than a support ticket.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as { opted_in?: unknown }
  if (typeof body.opted_in !== "boolean") {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "opted_in must be a boolean" })
  }

  const { seller, meta, member } = await loadContext(req, sellerId)
  if (!seller) {
    return res.status(404).json({ type: "not_found", message: "Seller not found" })
  }

  const sellerExtension = req.scope.resolve(
    "sellerExtension"
  ) as Parameters<typeof updateSellerMetadataRecord>[0]
  if (meta) {
    await updateSellerMetadataRecord(sellerExtension, [
      { id: meta.id, node_operator_opt_in: body.opted_in },
    ])
  } else {
    await createSellerMetadataRecord(sellerExtension, [
      { seller_id: sellerId, node_operator_opt_in: body.opted_in },
    ])
  }

  const blackstar = req.scope.resolve<BlackstarFulfillmentService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )

  if (!body.opted_in) {
    // Opting out revokes the credential here. Blackstar keeps the node — the
    // operator may have work in flight — but nothing this seller holds can sign
    // for it any more.
    await blackstar.revokeNodeOperatorCredential(sellerId)
    log.info(`[node-operator] ${sellerId} opted out`)
    return res.json({ node_operator: { opted_in: false, credential: null } })
  }

  const result = await provisionNodeOperator(req.scope, {
    sellerId,
    sellerName: seller.name ?? sellerId,
    memberEmail: member?.email ?? "",
    memberName: member?.name ?? seller.name ?? sellerId,
    vendorType: meta?.vendor_type ?? "general",
    optedIn: true,
  })

  const credential = await blackstar.getNodeOperatorCredential(sellerId)
  log.info(`[node-operator] ${sellerId} opted in (emitted=${result.emitted})`)

  return res.json({
    node_operator: {
      opted_in: true,
      credential,
      // Shown once, here and nowhere else.
      secret: result.secret ?? null,
      provisioned: result.emitted,
    },
  })
}
