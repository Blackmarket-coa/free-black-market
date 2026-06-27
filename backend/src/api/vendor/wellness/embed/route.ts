import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createLogger } from "../../../../shared/logger"
import { EMBED_KEYS_MODULE } from "../../../../modules/embed-keys"
import type EmbedKeysService from "../../../../modules/embed-keys/service"
import { sellerId, wellnessService, fail } from "../_helpers"

const log = createLogger("api/vendor/wellness/embed")

// GET /vendor/wellness/embed — embed config for the connect.js storefront:
// the seller's (masked) publishable key, a copy-paste snippet, and the set of
// embeddable offerings (session types + classes flagged is_embeddable).
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const seller = await sellerId(req, res)
  if (!seller) return
  try {
    const svc = wellnessService(req)

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

    const sessionTypes = (await svc.listSessionTypes({
      seller_id: seller,
      is_active: true,
    })) as Array<{ id: string; name: string; is_embeddable: boolean }>
    const classes = (await svc.listClassEvents({
      seller_id: seller,
    })) as Array<{ id: string; title: string; is_embeddable: boolean }>

    const snippet =
      `<script src="https://freeblackmarket.com/connect.js"\n` +
      `  data-fbm-vendor="${seller}"\n` +
      `  data-fbm-key="${maskedKey ?? "pk_live_…"}"\n` +
      `  data-fbm-theme="warm">\n</script>\n<div data-fbm="products"></div>`

    return res.json({
      masked_key: maskedKey,
      snippet,
      embeddable: {
        session_types: sessionTypes.map((s) => ({
          id: s.id,
          name: s.name,
          embedded: s.is_embeddable,
        })),
        classes: classes.map((c) => ({
          id: c.id,
          name: c.title,
          embedded: c.is_embeddable,
        })),
      },
    })
  } catch (e) {
    return fail(res, log, "GET embed config", e)
  }
}
