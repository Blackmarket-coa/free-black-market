import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VendorUsageRecord } from "./models"

export type UsageRecord = {
  id: string
  seller_id: string
  metric: string
  period_start: Date
  period_end: Date
  quantity: number
  billed_at: Date | null
  charge_id: string | null
}

class VendorUsageService extends MedusaService({
  VendorUsageRecord,
}) {
  /**
   * A raw pg connection, or null when one is not reachable (unit tests without
   * DI). Mirrors the accessor `demand-pool` and `hawala-ledger` use, for the
   * same reason: the increment has to be one atomic statement, and the ORM has
   * no expression-update primitive.
   */
  private resolvePgConnection(): {
    raw: (sql: string, bindings?: unknown[]) => Promise<any>
  } | null {
    try {
      const container = (this as unknown as { __container__?: Record<string, unknown> })
        .__container__
      const conn = container?.[ContainerRegistrationKeys.PG_CONNECTION]
      return (conn as { raw: (s: string, b?: unknown[]) => Promise<any> }) ?? null
    } catch {
      return null
    }
  }

  /**
   * Add `delta` to a seller's counter for a metric and period.
   *
   * One statement: `INSERT … ON CONFLICT … DO UPDATE SET quantity = quantity +
   * EXCLUDED.quantity`. This runs on the embed request path, which is the
   * highest-volume path in the system, so it must be a single round trip and
   * must never lose an increment to a concurrent request — a read-modify-write
   * would drop increments precisely when a vendor is busiest, i.e. exactly when
   * the number starts to matter for billing.
   *
   * Returns the new total, or null when no connection is reachable. Never
   * throws: metering must not be able to fail a vendor's storefront traffic.
   * Losing a count is a billing inaccuracy; failing the request is an outage,
   * and between those two the choice is not close.
   */
  async recordUsage(input: {
    seller_id: string
    metric: string
    period_start: Date
    period_end: Date
    delta: number
  }): Promise<number | null> {
    const delta = Math.max(0, Math.floor(input.delta || 0))
    if (!input.seller_id || !input.metric || delta === 0) return null

    const pg = this.resolvePgConnection()
    if (!pg) return null

    try {
      const result = await pg.raw(
        `INSERT INTO vendor_usage_record
           (id, seller_id, metric, period_start, period_end, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON CONFLICT (seller_id, metric, period_start) WHERE deleted_at IS NULL
         DO UPDATE SET quantity = vendor_usage_record.quantity + EXCLUDED.quantity,
                       updated_at = NOW()
         RETURNING quantity`,
        [
          `vur_${input.seller_id}_${input.metric}_${input.period_start.toISOString().slice(0, 7)}`,
          input.seller_id,
          input.metric,
          input.period_start,
          input.period_end,
          delta,
        ]
      )
      const row = result?.rows?.[0]
      return row ? Number(row.quantity) : null
    } catch {
      // Swallow deliberately — see the note above on why metering must never
      // fail the request it is measuring.
      return null
    }
  }

  /** A seller's counter for one metric and period, or null if never recorded. */
  async getPeriodUsage(
    seller_id: string,
    metric: string,
    period_start: Date
  ): Promise<UsageRecord | null> {
    const rows = (await this.listVendorUsageRecords({
      seller_id,
      metric,
      period_start,
    })) as unknown as UsageRecord[]
    return rows?.[0] ?? null
  }

  /**
   * Unbilled counters for a closed period — the close job's work list.
   *
   * Filtered on `billed_at: null` so a re-run skips what it already charged
   * without needing to reason about which sellers it saw last time.
   */
  async listUnbilledForPeriod(
    metric: string,
    period_start: Date
  ): Promise<UsageRecord[]> {
    return (await this.listVendorUsageRecords({
      metric,
      period_start,
      billed_at: null,
    })) as unknown as UsageRecord[]
  }

  /** Stamp a counter as billed. Idempotent by the caller's own guard. */
  async markBilled(id: string, charge_id: string | null): Promise<void> {
    await this.updateVendorUsageRecords({
      id,
      billed_at: new Date(),
      charge_id,
    })
  }
}

export default VendorUsageService
