import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import {
  summarisePeriod,
  type PatronageAllocationRow,
  type PatronageAllocationStore,
} from "../../../../modules/hawala-ledger/patronage-review"

/**
 * GET /admin/hawala/patronage
 *
 * The patronage allocation table for review. `jobs/patronage-refund.ts` stops
 * at `status=computed` so an operator can review before disbursement; this is
 * the surface that review happens on, and until now it did not exist.
 *
 * Authentication comes from `/admin/hawala/**` in this surface's
 * `middlewares.ts`. docs/TRANSMUTATION_STRATEGY.md §5.5.
 *
 * Query: `period_key` (e.g. "2026-Q2") to scope to one period; `status` to
 * filter. Omitting `period_key` returns a summary per period rather than every
 * row ever computed.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PatronageAllocationStore>(HAWALA_LEDGER_MODULE)
  const { period_key, status } = req.query as {
    period_key?: string
    status?: string
  }

  const filters: Record<string, unknown> = {}
  if (period_key) filters.period_key = period_key
  if (status) filters.status = status

  const rows = (await service.listPatronageAllocations(filters)) ?? []

  if (period_key) {
    return res.json({
      period: summarisePeriod(period_key, rows),
      allocations: rows,
    })
  }

  // No period given: one summary row per period, newest key first. A single
  // flat list of every allocation ever computed is not a reviewable thing.
  const byPeriod = new Map<string, PatronageAllocationRow[]>()
  for (const row of rows) {
    const list = byPeriod.get(row.period_key) ?? []
    list.push(row)
    byPeriod.set(row.period_key, list)
  }

  const periods = [...byPeriod.entries()]
    .map(([key, periodRows]) => summarisePeriod(key, periodRows))
    .sort((a, b) => b.period_key.localeCompare(a.period_key))

  res.json({ periods, count: periods.length })
}
