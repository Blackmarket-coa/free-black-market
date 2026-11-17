import path from "path"

/**
 * The middlewares FBM puts in front of its main checkout, `POST
 * /store/carts/:id/complete` (Mercur's route), and the order they run in.
 *
 * 1. `refuseGuardedCartCompletion` (SD-54, SD-72 (a)): the tier, Coalition
 *    Credits and order-cycle guards, which Mercur's `splitAndCompleteCartWorkflow`
 *    never runs. Read-only; it only refuses.
 * 2. `refuseCompletionOnPaymentAmountMismatch` (SD-115), which can write: it
 *    puts a refused cart's payment side right, and retires orphaned payments
 *    before a completion goes on. After the guards, so that it acts only for
 *    a cart they let through.
 * 3. `refuseUnfinishedCartCompletion` (SD-53), which holds the route's answer
 *    and checks that Mercur's run finished. Last, so that a refusal from the
 *    two before it is answered at once and not held.
 *
 * The three sit in two entries of `src/api/middlewares.ts` and one spread
 * route set, so their order is the order in which Medusa's loader reads them
 * and its sorter keeps them. That is what this asks: the real
 * `MiddlewareFileLoader` over `src/api` and the real `RoutesSorter`, with a
 * stand-in for Mercur's handler (it lives outside `src/api`), as
 * `ApiLoader` sorts them before registering each on express in turn.
 */

// Requiring the route sets creates the rate limiters; pin the in-memory store
// first, as the other loader specs do.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

import { refuseGuardedCartCompletion } from "../middlewares/cart-completion-guards"
import { refuseCompletionOnPaymentAmountMismatch } from "../middlewares/cart-payment-refresh"
import { refuseUnfinishedCartCompletion } from "../middlewares/cart-completion-finished"

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => {
    scanDir(dir: string): Promise<void>
    getMiddlewares(): LoadedMiddleware[]
  }
}
const { RoutesSorter } = require(path.join(httpDir, "routes-sorter")) as {
  RoutesSorter: new (routes: Entry[]) => { sort(): Entry[] }
}

type Handler = (...args: unknown[]) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type StandInRoute = { isRoute: true; matcher: string; method: string; handler: Handler }
type Entry = LoadedMiddleware | StandInRoute

const API_DIR = path.resolve(__dirname, "..")
const MATCHER = "/store/carts/:id/complete"

/** What express runs for POST on exactly this matcher, in the order it was registered. */
async function mainCheckoutChain(): Promise<{ chain: Handler[]; mercur: Handler }> {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const mercur: Handler = function mercurCompleteRoute() {}
  const sorted = new RoutesSorter([...loader.getMiddlewares(), { isRoute: true, matcher: MATCHER, method: "POST", handler: mercur }]).sort()
  const chain = sorted
    .filter((e) => e.matcher === MATCHER && ("isRoute" in e ? e.method === "POST" : !e.methods || e.methods.includes("POST")))
    .map((e) => e.handler)
  return { chain, mercur }
}

describe("POST /store/carts/:id/complete, FBM's middlewares in front of Mercur's route", () => {
  it("runs the guards, then the payment-amount check, then the SD-53 check, then Mercur's handler, and nothing else of FBM's on that matcher", async () => {
    const { chain, mercur } = await mainCheckoutChain()
    expect(chain).toEqual([refuseGuardedCartCompletion, refuseCompletionOnPaymentAmountMismatch, refuseUnfinishedCartCompletion, mercur])
  })
})
