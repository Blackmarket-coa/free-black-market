import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/vendor/hawala/pools/[id]/withdraw")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { isCarriedPool } from "../../../../../../modules/hawala-ledger/carrier"
import { featureFlagState } from "../../../../../../shared/feature-flags"
import { resolveRequestIdempotencyKey } from "../../../../../../shared/request-idempotency"
import HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { withdrawPoolSchema, validateInput } from "../../../../../hawala-validation"
import { resolveVendorSellerId } from "../../../seller-context"

/**
 * POST /vendor/hawala/pools/:id/withdraw
 * Withdraw funds from pool to vendor earnings
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const { id } = req.params

  const sellerId = await resolveVendorSellerId(req)
  if (!sellerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  // Validate input
  const validation = validateInput(withdrawPoolSchema, req.body)
  if (!validation.success) {
    return res.status(400).json({ error: validation.error })
  }
  const { amount, description } = validation.data

  try {
    const pool = await hawalaService.retrieveInvestmentPool(id)
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" })
    }

    if (pool.producer_id !== sellerId) {
      return res.status(403).json({ error: "Access denied" })
    }

    // A carried pool's funds are held by its nonprofit carrier, not on BMC's
    // ledger (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b): there is nothing
    // here to withdraw. Refused before any balance read, account creation or
    // transfer — createTransfer would refuse the leg too, but by then an
    // earnings account could have been minted.
    if (isCarriedPool(pool)) {
      return res.status(409).json({
        type: "carried_pool",
        message: `This pool is carried by ${pool.carrier_org_key}; its funds are held by the carrier and cannot be withdrawn from BMC's ledger.`,
      })
    }

    // Designated legacy funds (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8): with
    // FF_NONPROFIT_PARITY_V1 on, the ledger money already in an uncarried pool
    // is held in a DESIGNATED account — it may only go back to the people who
    // contributed it (refund reversals, the operator's designated returns),
    // never into the producer's own earnings. Refused here before any balance
    // read, earnings-account creation or transfer; the service refuses the
    // same leg (`designated_outbound_only`) for any other caller. Flag off:
    // unchanged.
    if (featureFlagState.isEnabled("NONPROFIT_PARITY_V1")) {
      return res.status(409).json({
        type: "designated_outbound_only",
        message:
          "This pool's funds are held in a designated account: they can only be returned to the people who contributed them, not withdrawn to your earnings.",
      })
    }

    // Check pool balance
    const poolBalance = await hawalaService.getAccountBalance(pool.ledger_account_id)
    if (poolBalance.available_balance < amount) {
      return res.status(400).json({
        error: `Insufficient pool balance. Available: $${poolBalance.available_balance.toFixed(2)}`,
      })
    }

    // Get or create seller earnings account
    let earningsAccounts = await hawalaService.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })

    if (earningsAccounts.length === 0) {
      const account = await hawalaService.createAccount({
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: sellerId,
      })
      earningsAccounts = [account]
    }

    // Transfer from pool to earnings. Deterministic per request: a UUID here
    // meant every retry minted a new key, so the ledger's uniqueness check
    // never matched and the withdrawal ran again.
    const { key: idempotencyKey } = resolveRequestIdempotencyKey({
      scope: "pool-withdraw",
      actorId: sellerId,
      headers: req.headers,
      body: req.body,
      payload: { pool_id: id, amount },
    })
    const entry = await hawalaService.createTransfer({
      debit_account_id: pool.ledger_account_id,
      credit_account_id: earningsAccounts[0].id,
      amount,
      entry_type: "WITHDRAWAL",
      description: description || "Pool withdrawal to earnings",
      investment_pool_id: id,
      idempotency_key: idempotencyKey,
    })

    res.json({
      success: true,
      entry,
      message: `$${amount.toFixed(2)} transferred to earnings account`,
    })
  } catch (error) {
    log.error("Error withdrawing from pool:", error)
    res.status(400).json({ error: "Failed to process withdrawal" })
  }
}
