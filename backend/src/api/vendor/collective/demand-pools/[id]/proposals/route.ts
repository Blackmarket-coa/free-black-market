import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/vendor/collective/demand-pools/[id]/proposals")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import { BARGAINING_MODULE } from "../../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../../modules/bargaining/service"

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

const submitProposalSchema = z.object({
  unit_price: z.number().positive(),
  currency_code: z.string().default("USD"),
  min_quantity: z.number().int().positive(),
  max_quantity: z.number().int().positive().optional(),
  volume_tiers: z
    .array(
      z.object({
        min_qty: z.number().int().positive(),
        max_qty: z.number().int().positive(),
        unit_price: z.number().positive(),
      })
    )
    .optional(),
  fulfillment_timeline_days: z.number().int().positive().optional(),
  delivery_method: z.string().optional(),
  delivery_cost: z.number().min(0).optional(),
  certifications: z.array(z.string()).optional(),
  compliance_notes: z.string().optional(),
  payment_terms: z.string().optional(),
  notes: z.string().optional(),
  // Optional: submit to a bargaining group
  bargaining_group_id: z.string().optional(),
  bargaining_proposal_title: z.string().optional(),
  bargaining_terms: z.record(z.string(), z.unknown()).optional(),
})

// GET /vendor/collective/demand-pools/:id/proposals (vendor's own proposals)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const proposals = await demandPoolService.listSupplierProposals({
      demand_post_id: id,
      supplier_id: vendorId,
    })

    res.json({ proposals })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    log.error("[GET vendor proposals] Error:", message)
    res.status(500).json({ error: "Failed to retrieve proposals", details: message })
  }
}

// POST /vendor/collective/demand-pools/:id/proposals
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = submitProposalSchema.parse(req.body)
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Submit to demand pool
    const proposal = await demandPoolService.submitProposal({
      demand_post_id: id,
      supplier_id: vendorId,
      unit_price: body.unit_price,
      currency_code: body.currency_code,
      min_quantity: body.min_quantity,
      max_quantity: body.max_quantity,
      volume_tiers: body.volume_tiers,
      fulfillment_timeline_days: body.fulfillment_timeline_days,
      delivery_method: body.delivery_method,
      delivery_cost: body.delivery_cost,
      certifications: body.certifications,
      compliance_notes: body.compliance_notes,
      payment_terms: body.payment_terms,
      notes: body.notes,
    })

    // Also submit to bargaining group if specified
    let bargainingProposal: any = null
    if (body.bargaining_group_id) {
      const bargainingService = req.scope.resolve<BargainingModuleService>(
        BARGAINING_MODULE
      )

      bargainingProposal = await bargainingService.submitGroupProposal({
        group_id: body.bargaining_group_id,
        proposer_id: vendorId,
        proposer_type: "SELLER",
        proposal_type: "SUPPLIER_OFFER",
        title: body.bargaining_proposal_title || `Proposal for demand ${id}`,
        terms: body.bargaining_terms || {
          unit_price: body.unit_price,
          min_quantity: body.min_quantity,
          volume_tiers: body.volume_tiers,
          delivery_method: body.delivery_method,
          payment_terms: body.payment_terms,
        },
        unit_price: body.unit_price,
        volume_tiers: body.volume_tiers,
        fulfillment_timeline: body.fulfillment_timeline_days
          ? `${body.fulfillment_timeline_days} days`
          : undefined,
      })
    }

    res.status(201).json({
      proposal,
      bargaining_proposal: bargainingProposal,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = getErrorMessage(error)
    log.error("[POST vendor proposal] Error:", message)
    res.status(400).json({ error: message })
  }
}
