import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"

/** Resolve the authenticated seller id (set by the vendor seller-context guard). */
export function getSellerId(req: MedusaRequest): string | null {
  const r = req as VendorRequest
  return (r.auth_context?.actor_id as string) ?? r._seller_id ?? null
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
      const members: Array<{ id?: string; role?: string }> =
        data?.[0]?.members ?? []
      customerId =
        members.find((m) => m.role === "owner")?.id ?? members[0]?.id ?? null
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
