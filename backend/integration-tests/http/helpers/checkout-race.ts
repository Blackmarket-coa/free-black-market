import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * SD-48: what a checkout did about the cart's lock and its seller check, for
 * the double-submit scenarios of the subscription and digital-product
 * checkouts. Both spy on the app's own services (the locking module, the
 * query) and pass every call through; the spec's `jest.restoreAllMocks()`
 * removes them.
 */
export function checkoutRaceProbes(container: () => any) {
  /**
   * Every attempt to take the lock on `key`: how many were refused because
   * someone held it (a checkout kept waiting) and how many succeeded.
   */
  function lockAttempts(key: string) {
    const locking = container().resolve(Modules.LOCKING)
    const acquire = locking.acquire.bind(locking)
    const seen = { refused: 0, taken: 0 }
    jest.spyOn(locking, "acquire").mockImplementation(async (keys: any, ...rest: any[]) => {
      const mine = [keys].flat().includes(key)
      try {
        const taken = await acquire(keys, ...rest)
        if (mine) seen.taken++
        return taken
      } catch (e) {
        if (mine) seen.refused++
        throw e
      }
    })
    return seen
  }

  /**
   * How many checkouts checked this cart's seller (the resolve step's read
   * of the cart's items) — the first step of a first completion, which a
   * replay skips.
   */
  function sellerChecks(cartId: string) {
    const query = container().resolve(ContainerRegistrationKeys.QUERY)
    const graph = query.graph.bind(query)
    const seen = { count: 0 }
    jest.spyOn(query, "graph").mockImplementation(async (q: any, ...rest: any[]) => {
      if (q?.entity === "cart" && q?.filters?.id === cartId && JSON.stringify(q.fields) === '["id","items.product_id"]') {
        seen.count++
      }
      return graph(q, ...rest)
    })
    return seen
  }

  return { lockAttempts, sellerChecks }
}
