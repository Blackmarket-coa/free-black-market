import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { resolveRequestIdempotencyKey } from "../../../../shared/request-idempotency"

/**
 * GET /store/hawala/investments
 * Get customer's investments
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    // Get customer's investments
    const investments = await hawalaService.listInvestments({
      customer_id: customerId,
    })

    // Fetch pool details in bulk to avoid N+1 queries
    const uniquePoolIds = Array.from(new Set(investments.map((inv) => inv.pool_id).filter(Boolean)))
    const pools = uniquePoolIds.length
      ? await hawalaService.listInvestmentPools({ id: uniquePoolIds as any })
      : []
    const poolById = new Map(pools.map((pool) => [pool.id, pool]))

    const investmentsWithPools = investments.map((inv) => {
      const pool = poolById.get(inv.pool_id)
      return {
        ...inv,
        pool: pool
          ? {
              id: pool.id,
              name: pool.name,
              producer_id: pool.producer_id,
              roi_type: pool.roi_type,
              status: pool.status,
            }
          : null,
      }
    })

    // Calculate totals
    const totalInvested = investments.reduce((sum, i) => sum + Number(i.amount), 0)
    const totalReturns = investments.reduce((sum, i) => sum + Number(i.actual_return || 0), 0)

    res.json({
      investments: investmentsWithPools,
      summary: {
        total_invested: totalInvested,
        total_returns: totalReturns,
        active_investments: investments.filter(i => i.status === "CONFIRMED").length,
      },
    })
  } catch (_error) {
    res.status(500).json({ error: "Failed to fetch investments" })
  }
}

/**
 * POST /store/hawala/investments
 * Create a new investment
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { pool_id, amount } = req.body as {
    pool_id: string
    amount: number
  }

  if (!pool_id || !amount) {
    return res.status(400).json({ error: "pool_id and amount are required" })
  }

  try {
    // Get pool
    const pool = await hawalaService.retrieveInvestmentPool(pool_id)
    if (!pool) {
      return res.status(404).json({ error: "Investment pool not found" })
    }

    if (pool.status !== "ACTIVE") {
      return res.status(400).json({ error: "Investment pool is not active" })
    }

    if (amount < Number(pool.minimum_investment)) {
      return res.status(400).json({
        error: `Minimum investment is $${pool.minimum_investment}`,
      })
    }

    // Get customer's wallet
    const wallets = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    if (wallets.length === 0) {
      return res.status(400).json({ error: "Please create a wallet first" })
    }

    const wallet = wallets[0]
    const balance = await hawalaService.getAccountBalance(wallet.id)

    if (balance.available_balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" })
    }

    // Create investment
    const investment = await hawalaService.createInvestment({
      pool_id,
      investor_account_id: wallet.id,
      customer_id: customerId,
      amount,
      source: "DIRECT",
      idempotency_key: resolveRequestIdempotencyKey({
        scope: "invest",
        actorId: customerId,
        headers: req.headers,
        body: req.body,
        payload: { pool_id, amount },
      }).key,
    })

    res.status(201).json({ investment })
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
}
