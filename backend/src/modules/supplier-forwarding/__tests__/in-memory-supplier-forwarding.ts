import type SupplierForwardingModuleService from "../service"

/**
 * In-memory stand-in for the four generated CRUD methods of
 * `SupplierForwardingModuleService` that the supplier status webhook calls.
 * Filters are exact-match on every key given; `order: { created_at }` and
 * `take` behave as the generated list does. `created_at` is strictly
 * increasing, so "latest update" is unambiguous.
 */

type Row = Record<string, unknown> & { id: string; created_at: Date }
type ListConfig = { take?: number; order?: { created_at?: "ASC" | "DESC" } }

export type SupplierForwardingSeed = {
  profiles?: Array<Record<string, unknown>>
  attempts?: Array<Record<string, unknown>>
  updates?: Array<Record<string, unknown>>
}

export function makeInMemorySupplierForwarding(seed: SupplierForwardingSeed = {}) {
  let seq = 0
  const stamp = () => new Date(Date.UTC(2026, 10, 15, 12, 0, 0) + ++seq * 1000)
  const withIds = (prefix: string, rows: Array<Record<string, unknown>> = []): Row[] =>
    rows.map((r) => ({ id: `${prefix}_${++seq}`, created_at: stamp(), ...r }))

  const tables = {
    profiles: withIds("supprof", seed.profiles),
    attempts: withIds("sfa", seed.attempts),
    updates: withIds("mfu", seed.updates),
  }

  const list =
    (rows: Row[]) =>
    async (filters: Record<string, unknown> = {}, config: ListConfig = {}) => {
      let out = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
      const dir = config.order?.created_at
      if (dir) {
        out = [...out].sort((a, b) =>
          dir === "DESC"
            ? b.created_at.getTime() - a.created_at.getTime()
            : a.created_at.getTime() - b.created_at.getTime()
        )
      }
      if (config.take !== undefined) out = out.slice(0, config.take)
      return out.map((r) => ({ ...r }))
    }

  const service = {
    listSupplierProfiles: list(tables.profiles),
    listForwardingAttempts: list(tables.attempts),
    listManualFulfillmentUpdates: list(tables.updates),
    async createManualFulfillmentUpdates(data: Record<string, unknown>) {
      const row: Row = { id: `mfu_${++seq}`, created_at: stamp(), notes: null, metadata: null, ...data }
      tables.updates.push(row)
      return { ...row }
    },
  }

  return {
    service: service as unknown as SupplierForwardingModuleService,
    tables,
  }
}
