import { createLogger } from "../../../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/barter/[proposalId]/accept")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../../../../../../modules/demand-pool/service"
import { BARTER_MODULE } from "../../../../../../../../modules/barter"
import type BarterModuleService from "../../../../../../../../modules/barter/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../../../modules/hawala-ledger/service"

/**
 * POST /store/collective/demand-pools/:id/barter/:proposalId/accept
 *
 * The pool's creator accepts a trade, and it settles immediately — there is no
 * escrow to hold, because nothing monetary is being held.
 *
 * The trade is recorded on the **GIFT** rail: non-settling, zero-value, kept
 * for audit. That is the honest shape. A barter is a real event the pool's
 * ledger trail (Phase 7) should show, but no money moved, and booking a
 * notional value would corrupt the very arithmetic that trail invites people
 * to check for themselves.
 *
 * Authorization lives here because it spans two modules: only the demand
 * pool's creator may accept a trade that fulfils their pool, and `barter`
 * deliberately knows nothing about demand pools.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id, proposalId } = req.params

  try {
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )
    const posts = await demandPoolService.listDemandPosts({ id })
    if (posts.length === 0) {
      return res.status(404).json({ error: "Demand pool not found" })
    }
    if (posts[0].creator_id !== customerId) {
      return res
        .status(403)
        .json({ error: "Only the pool creator can accept a barter proposal" })
    }

    const barterService = req.scope.resolve<BarterModuleService>(BARTER_MODULE)
    const accepted = await barterService.acceptBarter(proposalId, customerId)

    // Audit entry, best-effort. The trade is agreed either way; failing the
    // acceptance because a zero-value audit row did not write would be the
    // wrong trade-off.
    let ledgerEntryId: string | null = null
    try {
      const hawala = req.scope.resolve<HawalaLedgerModuleService>(
        HAWALA_LEDGER_MODULE
      )
      const entry = await hawala.createTransfer({
        debit_account_id: await resolveGiftAccount(hawala, accepted.proposer_id as string),
        credit_account_id: await resolveGiftAccount(hawala, customerId),
        // Zero, and that is the whole point: a barter is a real event the
        // pool's ledger trail should show, but no money moved. Booking a
        // notional value would corrupt the arithmetic Phase 7 invites people
        // to check. `createTransfer` accepts 0 — it rejects only negative and
        // non-finite amounts.
        amount: 0,
        entry_type: "TRANSFER",
        description: `Barter fulfilment for demand pool ${id}`,
        reference_type: "ORDER",
        reference_id: id,
        idempotency_key: `barter-${proposalId}`,
        metadata: {
          non_monetary: true,
          barter_proposal_id: proposalId,
          // The GIFT rail is the natural home for this, but a rail is a
          // property of the accounts, not of the entry — `createTransfer`
          // takes no currency_code. Until GIFT-denominated accounts exist this
          // is a zero-value entry on the parties' wallets, flagged here rather
          // than mislabelled as something it is not.
          intended_rail: "GIFT",
        },
      })
      ledgerEntryId = entry.id as string
    } catch (ledgerErr) {
      log.error(
        `[POST /store/collective/demand-pools/${id}/barter/${proposalId}/accept] GIFT audit entry failed`,
        ledgerErr
      )
    }

    const completed = await barterService.completeBarter(proposalId, ledgerEntryId)

    res.json({
      proposal: completed,
      // Say plainly that nothing monetary moved, so nobody reads a completed
      // barter as a payment.
      settled: "NON_MONETARY",
      note: "Recorded as a zero-value ledger entry for audit; no funds moved.",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to accept"
    log.error(
      `[POST /store/collective/demand-pools/${id}/barter/${proposalId}/accept] Error:`,
      message
    )
    const notFound = /not found/i.test(message)
    const conflict = /already been accepted/i.test(message)
    res.status(notFound ? 404 : conflict ? 409 : 400).json({ error: message })
  }
}

/** A GIFT flow still needs two accounts to hang off; the wallet is the natural one. */
async function resolveGiftAccount(
  hawala: HawalaLedgerModuleService,
  ownerId: string
): Promise<string> {
  const existing = await hawala.listLedgerAccounts({
    owner_id: ownerId,
    account_type: "USER_WALLET",
  })
  if (existing.length > 0) return existing[0].id as string
  const created = await hawala.createAccount({
    account_type: "USER_WALLET",
    owner_type: "CUSTOMER",
    owner_id: ownerId,
  })
  return created.id as string
}
