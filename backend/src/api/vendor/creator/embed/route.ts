import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { createLogger } from "../../../../shared/logger"
import { listCreatorMembershipTiers } from "../../../../lib/creator-hub"
import { EMBED_KEYS_MODULE } from "../../../../modules/embed-keys"
import type EmbedKeysService from "../../../../modules/embed-keys/service"
import { EMBED_ANALYTICS_MODULE } from "../../../../modules/embed-analytics"
import type EmbedAnalyticsService from "../../../../modules/embed-analytics/service"

const log = createLogger("api/vendor/creator/embed")

/**
 * GET /vendor/creator/embed — embed config for the connect.js SDK, mirroring
 * /vendor/wellness/embed. Returns the seller's masked publishable key, a
 * copy-paste snippet, the embeddable offerings (membership tiers + published
 * products), and a simple embed-traffic funnel. Each section degrades to
 * empty/zeroed when its source isn't wired, so the creator-portal Embed page
 * works outside mock mode (previously it 404'd on this missing route).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await requireSellerId(req, res)
  if (!seller) return

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Masked publishable key (never returns the raw key).
    let maskedKey: string | null = null
    try {
      const embedKeys = req.scope.resolve(EMBED_KEYS_MODULE) as EmbedKeysService
      const keys = (await embedKeys.listVendorEmbedKeys(
        { seller_id: seller, revoked_at: null } as never,
        { order: { created_at: "DESC" }, take: 1 }
      )) as Array<{ last_four: string }>
      if (keys?.[0]) maskedKey = `pk_live_…${keys[0].last_four}`
    } catch (err) {
      log.warn("embed: key lookup failed", err)
    }

    // Membership tiers.
    let memberships: Array<{ id: string; name: string; embedded: boolean }> = []
    try {
      const tiers = await listCreatorMembershipTiers(req.scope, seller)
      memberships = tiers.map((t) => ({ id: t.id, name: t.name, embedded: true }))
    } catch (err) {
      log.warn("embed: membership lookup failed", err)
    }

    // Published products for this seller.
    let products: Array<{ id: string; name: string; embedded: boolean }> = []
    try {
      const { data: rows } = await query.graph({
        entity: "seller_product",
        fields: ["product.id", "product.title", "product.status"],
        filters: { seller_id: seller },
      })
      const sellerProducts = (rows || []) as Array<{
        product?: { id?: string; title?: string; status?: string }
      }>
      products = sellerProducts
        .map((sp) => sp.product)
        .filter(
          (p): p is { id: string; title: string; status: string } =>
            !!p?.id && p.status === "published"
        )
        .slice(0, 50)
        .map((p) => ({ id: p.id, name: p.title, embedded: true }))
    } catch (err) {
      log.warn("embed: product lookup failed", err)
    }

    // Embed-traffic funnel (last 30 days), mapped onto the portal's shape.
    let analytics = { views: 0, clicks: 0, purchases: 0, conversion_pct: 0 }
    try {
      const svc = req.scope.resolve(
        EMBED_ANALYTICS_MODULE
      ) as EmbedAnalyticsService
      const agg = await svc.aggregateForSeller(seller, 30)
      const views = agg.funnel.views
      const purchases = agg.funnel.orders
      analytics = {
        views,
        clicks: agg.funnel.checkout_start,
        purchases,
        conversion_pct:
          views > 0 ? Math.round((purchases / views) * 1000) / 10 : 0,
      }
    } catch (err) {
      log.warn("embed: analytics lookup failed", err)
    }

    const snippet =
      `<script src="https://freeblackmarket.com/connect.js"\n` +
      `  data-fbm-vendor="${seller}"\n` +
      `  data-fbm-key="${maskedKey ?? "pk_live_…"}"\n` +
      `  data-fbm-theme="warm">\n</script>\n<div data-fbm="products"></div>`

    return res.json({
      masked_key: maskedKey,
      snippet,
      theme: "warm",
      embeddable: { memberships, products },
      analytics,
    })
  } catch (e) {
    log.error("GET creator embed config failed", e)
    return res.status(500).json({ message: "Failed to load embed config" })
  }
}
