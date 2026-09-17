import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "../../../../../shared/logger"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import type CooperativeService from "../../../../../modules/cooperative/service"

const log = createLogger("api/store/coalitions/storefront")

const MAX_PRODUCTS = 100

function cheapestPrice(variants: any[], currencyCode: string): number | null {
  let best: number | null = null
  for (const variant of variants || []) {
    for (const price of variant?.prices || []) {
      if (price?.currency_code !== currencyCode) continue
      const amount = Number(price.amount)
      if (!Number.isFinite(amount)) continue
      if (best === null || amount < best) best = amount
    }
  }
  return best
}

/**
 * GET /store/coalitions/:coalitionId/storefront
 *
 * The collective storefront: every member shop's published catalog under one
 * view, with each product attributed to the member who sells it.
 *
 * A coalition's FBM face is a `cooperative` row carrying the Blackout
 * coalition id. Member shops resolve through `cooperative_member.seller_id` —
 * NOT `producer_id`, which holds two different kinds of id depending on how
 * the member joined and therefore cannot resolve a catalog.
 *
 * Public and read-only: no auth, no member identities beyond the shop names
 * that are already public on each vendor page.
 *
 * Query: ?limit= (default 48, max 100) &currency_code= (default usd)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const coalitionId = String(req.params.coalitionId || "").trim()
  if (!coalitionId) {
    return res.status(400).json({ code: "bad_request", message: "coalitionId is required" })
  }

  const currencyCode = String(req.query.currency_code || "usd").toLowerCase()
  const limit = Math.min(
    MAX_PRODUCTS,
    Math.max(1, parseInt(String(req.query.limit || "48"), 10) || 48)
  )

  const cooperativeService = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)
  const [cooperative] = await cooperativeService.listCooperatives({
    blackout_coalition_id: coalitionId,
  })
  if (!cooperative || cooperative.is_active === false) {
    return res
      .status(404)
      .json({ code: "not_found", message: "No collective storefront for this coalition" })
  }
  if (cooperative.public_storefront_enabled === false) {
    return res
      .status(404)
      .json({ code: "storefront_disabled", message: "This coalition's storefront is not public" })
  }

  const members = await cooperativeService.listCooperativeMembers({
    cooperative_id: cooperative.id,
    is_active: true,
  })
  const sellerIds = [
    ...new Set(
      members
        .map((m: { seller_id?: string | null }) => m.seller_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]

  // A coalition whose members have not linked shops yet is an empty
  // storefront, not an error — the page still renders its members.
  if (sellerIds.length === 0) {
    return res.json({
      coalition_id: coalitionId,
      cooperative: { id: cooperative.id, name: cooperative.name, handle: cooperative.handle },
      sellers: [],
      products: [],
      count: 0,
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  let products: any[] = []
  let sellers: Array<{ id: string; name?: string; handle?: string }> = []
  try {
    const { data: rows } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "thumbnail",
        "status",
        "seller.id",
        "seller.name",
        "seller.handle",
        "variants.id",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ],
      filters: {
        // The "seller.id" join key is resolved at runtime; the typed
        // RemoteQueryFilters<"product"> does not model it. An array filter is
        // the one-query way to span N member shops — the storefront's
        // client-side filtering over a single page cannot represent N catalogs.
        "seller.id": sellerIds,
        status: "published",
      } as any,
      pagination: { take: limit },
    })
    const seen = new Map<string, { id: string; name?: string; handle?: string }>()
    products = (rows || []).map((p: any) => {
      if (p.seller?.id && !seen.has(p.seller.id)) {
        seen.set(p.seller.id, {
          id: p.seller.id,
          name: p.seller.name,
          handle: p.seller.handle,
        })
      }
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: p.thumbnail ?? null,
        price: cheapestPrice(p.variants, currencyCode),
        seller: p.seller ? { id: p.seller.id, name: p.seller.name, handle: p.seller.handle } : null,
      }
    })
    sellers = [...seen.values()]
  } catch (error) {
    // A catalog failure degrades to the member list rather than a 500 — the
    // coalition page is still useful without the grid.
    log.warn("coalition storefront catalog failed", {
      coalition_id: coalitionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
  return res.json({
    coalition_id: coalitionId,
    cooperative: { id: cooperative.id, name: cooperative.name, handle: cooperative.handle },
    sellers,
    products,
    count: products.length,
  })
}
