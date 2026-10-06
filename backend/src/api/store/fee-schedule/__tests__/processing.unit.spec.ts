import { GET } from "../route"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../../modules/payout-breakdown"
import { makeBreakdownService } from "../../../../modules/payout-breakdown/__tests__/fee-first-harness"

/**
 * F6-4: `/store/fee-schedule` publishes the processing model ONLY while
 * FF_FEE_FIRST_SPLIT_V1 is on, read from the same payout config the
 * settlement deducts. Off, the response deep-equals the pre-F6 one and the
 * payout module is never even resolved.
 */

const FLAG = PHASE0_FEATURE_FLAGS.FEE_FIRST_SPLIT_V1

type Body = Record<string, unknown> & {
  processing?: { model: string; percent: number | null; fixed_cents: number | null }
}

function call(scopeResolve: (key: string) => unknown) {
  const res = {
    body: undefined as unknown as Body,
    json(payload: unknown) {
      res.body = payload as Body
      return res
    },
  }
  const req = { scope: { resolve: jest.fn(scopeResolve) } }
  return { res, req, run: () => GET(req as never, res as never) }
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("GET /store/fee-schedule processing model", () => {
  it("flag off: deep-equals the response with no request scope at all, and resolves nothing", async () => {
    const withScope = call(() => {
      throw new Error("must not resolve anything with the flag off")
    })
    await withScope.run()
    // The pre-F6 route never touched `req`; the same call with an empty
    // request must still produce the identical body.
    const bare = { body: undefined as unknown as Body, json(p: unknown) { bare.body = p as Body; return bare } }
    await GET({} as never, bare as never)
    expect(withScope.res.body).toEqual(bare.body)
    expect("processing" in withScope.res.body).toBe(false)
    expect(withScope.req.scope.resolve).not.toHaveBeenCalled()
  })

  it("flag on: publishes fee_first with the payout config's percent and fixed cents", async () => {
    process.env[FLAG] = "true"
    const { svc } = makeBreakdownService({ processingPercent: 2.9, processingFixed: 30 })
    const c = call((key) => {
      if (key === PAYOUT_BREAKDOWN_MODULE) return svc
      throw new Error(`unexpected key ${key}`)
    })
    await c.run()
    expect(c.res.body.processing).toEqual({ model: "fee_first", percent: 2.9, fixed_cents: 30 })
    expect(c.req.scope.resolve).toHaveBeenCalledWith(PAYOUT_BREAKDOWN_MODULE)
  })

  it("flag on: follows the config, not a constant", async () => {
    process.env[FLAG] = "true"
    const { svc } = makeBreakdownService({ processingPercent: 3.4, processingFixed: 25 })
    const c = call(() => svc)
    await c.run()
    expect(c.res.body.processing).toEqual({ model: "fee_first", percent: 3.4, fixed_cents: 25 })
  })

  it("flag on, config unreadable: still says fee_first, with no figures it could not check", async () => {
    process.env[FLAG] = "true"
    const c = call(() => ({
      getDefaultConfig: async () => {
        throw new Error("db down")
      },
    }))
    await c.run()
    expect(c.res.body.processing).toEqual({ model: "fee_first", percent: null, fixed_cents: null })
  })

  it("flag on: everything else in the response is unchanged", async () => {
    const off = call(() => undefined)
    await off.run()
    process.env[FLAG] = "true"
    const { svc } = makeBreakdownService()
    const on = call(() => svc)
    await on.run()
    const rest = { ...on.res.body }
    delete rest.processing
    expect(rest).toEqual(off.res.body)
  })
})
