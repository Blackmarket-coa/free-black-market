import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { adminActorId } from "../../../advances/orgs/org-advance-shared"
import { carrierFeatureDisabled, sendCarrierError } from "../../carrier-shared"

/**
 * POST /admin/hawala/pools/:id/designated-returns — send ONE legacy ledger
 * investment back from an uncarried pool's designated account to its
 * investor's wallet: the wind-down primitive (docs/BMC_SURVIVAL_PROGRAMS.md
 * Decision 8; legal checkpoints L26, L3 — surfaced, not resolved).
 *
 * Body: `{ investment_id }` only (`.strict()`: an amount, an account or a
 * destination can never arrive from the request — the amount is the
 * investment's own, the destination is its own `investor_account_id`).
 * The service (`returnDesignatedFunds`) moves the money first — a REFUND leg
 * keyed `designated-return-<investment id>`, so a retry never moves it twice —
 * then marks the investment WITHDRAWN. It refuses a carried pool, a CARRIER
 * record, a non-CONFIRMED investment and an account that cannot cover it
 * (409, `type` = the reason), and the leg still passes createTransfer's
 * direction rule. No Stripe payout here: the investor's wallet exit is the
 * existing payout path. No automatic sweep: one operator action per
 * investment, naming its operator (401 without an admin actor).
 *
 * 201 `{ returned: true, ... }` on the first call; 200 `{ returned: false,
 * reason: "already_returned" }` on a replay. A missing pool or an investment
 * that is not in this pool is 404 (admin; no owner check, so no oracle).
 * Gated by FF_INVESTMENT_POOLS_V1 (the `/admin/hawala/pools*` matcher) AND
 * FF_NONPROFIT_PARITY_V1 (its own matcher, repeated here and in the service).
 */

const DesignatedReturnBody = z
  .object({
    investment_id: z.string().trim().min(1).max(100),
  })
  .strict()

export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (carrierFeatureDisabled(res)) return

  const parsed = DesignatedReturnBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_request",
      message: "Invalid designated return payload",
      errors: z.flattenError(parsed.error),
    })
  }
  const returnedBy = adminActorId(req)
  if (!returnedBy) {
    return res.status(401).json({ type: "unauthorized", message: "A designated return must name its operator." })
  }
  const { id } = req.params

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  try {
    const result = await hawala.returnDesignatedFunds(id, parsed.data.investment_id, { returned_by: returnedBy })
    return res.status(result.returned ? 201 : 200).json(result)
  } catch (error) {
    if (error instanceof Error && error.message === "Investment not found") {
      return res.status(404).json({ type: "not_found", message: error.message })
    }
    return sendCarrierError(res, error)
  }
}
