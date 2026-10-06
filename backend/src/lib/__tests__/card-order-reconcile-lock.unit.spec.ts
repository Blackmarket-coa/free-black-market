import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { reconcileCardOrder } from "../card-order-reconcile"

/**
 * Every card-order movement is serialized per order (second review, M2): two
 * callers that read different refunded totals must not both see "nothing
 * posted" and both post. The real-database spec cannot tell a lock from the
 * idempotency key (equal totals share a key), so this pins the lock itself:
 * taken, with a bounded wait, BEFORE the order is read, and the read happens
 * inside it.
 */
describe("reconcileCardOrder: per-order advisory lock", () => {
  it("takes the order's advisory lock before reading anything, and reads inside it", async () => {
    const calls: string[] = []
    let inside = false
    const trx = {
      raw: jest.fn(async (sql: string, bindings?: unknown[]) => {
        calls.push(`${sql} ${JSON.stringify(bindings ?? [])}`)
        return {}
      }),
    }
    const pg = {
      transaction: async (work: (t: typeof trx) => Promise<unknown>) => {
        inside = true
        try {
          return await work(trx)
        } finally {
          inside = false
        }
      },
    }
    const graph = jest.fn(async () => {
      calls.push(`graph inside=${inside}`)
      return { data: [] }
    })
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected container key: ${key}`)
      },
    }

    const result = await reconcileCardOrder(container, "order_1")
    expect(result.outcome).toBe("unreadable")
    expect(calls).toEqual([
      `SET LOCAL lock_timeout = '10s' []`,
      `SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?)) ["hawala-card-order","order_1"]`,
      "graph inside=true",
    ])
  })

  it("without a pg connection (unit tests) it still runs, unserialized", async () => {
    const graph = jest.fn(async () => ({ data: [] }))
    const container = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected container key: ${key}`)
      },
    }
    expect((await reconcileCardOrder(container, "order_1")).outcome).toBe("unreadable")
    expect(graph).toHaveBeenCalledTimes(1)
  })
})
