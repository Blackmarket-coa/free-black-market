import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import { sellerIdForVendorActor } from "../../../shared/seller-actor"

/**
 * The store a vendor request acts for, or null: what every vendor route that
 * keys store data reads (SD-145).
 *
 * Behind the vendor gate (`ensureSellerContext`) `auth_context.actor_id` is a
 * member id (`mem_`) for every vendor: Mercur links a login to a member, and
 * the gate turns a seller-id actor into its matched member for Mercur's
 * member-keyed guards. So the actor is never the store. This used to return
 * `actor_id ?? _seller_id`, the member id first, and some ninety vendor routes
 * that read it, or a local copy of it, kept a store's records per member:
 * customer tiers the wholesale cart never found, imported products linked to
 * no store, a manual fulfilment refused for every order, order cycles and
 * fees only their creator could manage.
 *
 * The store is the gate's `_seller_id` for a seller-id actor, taken as it is
 * in a request the gate resolved, and otherwise the live store of the member,
 * by the rule both gates apply (`shared/seller-actor.ts`). It answers nothing
 * itself: each caller sends its own refusal for null.
 */
export async function getSellerId(req: MedusaRequest): Promise<string | null> {
  const r = req as VendorRequest
  return (await sellerIdForVendorActor(r, r._seller_id || r.auth_context?.actor_id)) ?? null
}

/**
 * Build a best-effort `awardXp` callback that credits the existing progression
 * XP system when a quest stage advances. Kept OUT of the vendor-quest module so
 * the module stays decoupled from `progression` (mirrors collective-quest).
 *
 * Progression is customer-scoped, so we resolve the seller's owner member and
 * credit them. Any failure is swallowed — the `quest_stage_event.xp_awarded`
 * row is the authoritative record, XP crediting is a bonus.
 */
export function makeAwardXp(req: MedusaRequest) {
  return async (sellerId: string, amount: number, meta: Record<string, unknown>) => {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const progression = req.scope.resolve<{
      recordXpEvent(data: {
        customer_id: string
        role: string
        amount: number
        reason: string
        source_module?: string
        source_id?: string
        metadata?: Record<string, unknown>
      }): Promise<unknown>
    }>("progressionModuleService")

    // Resolve the seller's owner member to act as the XP subject.
    let customerId: string | null = null
    try {
      const { data } = await query.graph({
        entity: "seller",
        fields: ["id", "members.id", "members.role"],
        filters: { id: sellerId },
      })
      const members = (data?.[0]?.members ?? []) as Array<{
        id?: string
        role?: string
      } | null>
      customerId =
        members.find((m) => m?.role === "owner")?.id ?? members[0]?.id ?? null
    } catch {
      customerId = null
    }
    if (!customerId) return

    await progression.recordXpEvent({
      customer_id: customerId,
      role: "producer",
      amount,
      reason: "vendor-quest-stage",
      source_module: "vendor-quest",
      source_id: String(meta.quest_key ?? ""),
      metadata: meta,
    })
  }
}
