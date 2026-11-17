import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/barter")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARTER_MODULE } from "../../../../../../modules/barter"
import type BarterModuleService from "../../../../../../modules/barter/service"
import { publicBarterProposalView } from "../../../../../../modules/demand-pool/public-view"
import { poolNotFound, resolvePoolReader } from "../_pool-readers"

const proposeSchema = z.object({
  offering: z.string().min(1),
  wanting: z.string().min(1),
  estimated_hours: z.number().positive().optional(),
  bounty_id: z.string().optional(),
})

// GET /store/collective/demand-pools/:id/barter
//
// The pool's creator, who alone may accept a trade, and each trade's
// proposer read it whole; anyone else what it offers and wants, without who
// offered it, who accepted it or the ledger entry (`../_pool-readers.ts`).
// On a pool that is not public, someone who is neither its creator nor a
// participant sees only their own offers, and is answered as a missing pool
// when they have none.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  try {
    const reader = await resolvePoolReader(req, res)
    if (!reader) return

    const service = req.scope.resolve<BarterModuleService>(BARTER_MODULE)
    const proposals = await service.listBarterProposals({ demand_post_id: id })

    const proposedBy = (p: (typeof proposals)[number]) => reader.isCaller(p.proposer_id)
    const visible = reader.listed ? proposals : proposals.filter(proposedBy)
    if (!reader.listed && visible.length === 0) return poolNotFound(res)

    res.json({
      proposals: visible.map((p) => (reader.creator || proposedBy(p) ? p : publicBarterProposalView(p))),
      count: visible.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed"
    log.error(`[GET /store/collective/demand-pools/${id}/barter] Error:`, message)
    res.status(500).json({ error: "Failed to retrieve barter proposals" })
  }
}

/**
 * POST /store/collective/demand-pools/:id/barter
 *
 * Offer to fulfil this pool by trade rather than cash. The fourth value-add:
 * a demand pool exists because people want a thing, and whether that want is
 * met with money or a swap is a settlement detail — hard-coding "money" as the
 * only route is what makes every competitor category cash-only.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  try {
    const body = proposeSchema.parse(req.body)
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<BarterModuleService>(BARTER_MODULE)
    const proposal = await service.proposeBarter({
      proposer_id: customerId,
      // A bounty-targeted proposal still arrives on the pool's path, since
      // that is where a buyer is looking, but it is recorded against the
      // bounty so exactly one target holds.
      demand_post_id: body.bounty_id ? null : id,
      bounty_id: body.bounty_id ?? null,
      offering: body.offering,
      wanting: body.wanting,
      estimated_hours: body.estimated_hours ?? null,
    })

    res.status(201).json({ proposal })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = error instanceof Error ? error.message : "Failed"
    log.error(`[POST /store/collective/demand-pools/${id}/barter] Error:`, message)
    res.status(400).json({ error: message })
  }
}
