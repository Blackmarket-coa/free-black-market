import { GET } from "../route"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"

/**
 * A vendor's view of their own patronage.
 *
 * The gap this closes: allocations were computed quarterly and read by
 * nothing, so a member never learned a refund had been calculated for them.
 * What these tests hold is the scoping (a vendor sees only their own) and the
 * honesty of the copy (an approved allocation is not a payment).
 * docs/TRANSMUTATION_STRATEGY.md §5.5.
 */

jest.mock("../../seller-context", () => ({
  resolveVendorSellerId: jest.fn(),
}))
import { resolveVendorSellerId } from "../../seller-context"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "pa_1",
  seller_id: "sel_1",
  period_key: "2026-Q2",
  gross_volume: 1000,
  allocation_amount: 50,
  allocation_currency: "USD",
  status: "computed",
  paid_at: null,
  ...over,
})

const makeReq = (rows: any[]) => {
  const list = jest.fn(async (filters: any) =>
    rows.filter((r) => !filters?.seller_id || r.seller_id === filters.seller_id)
  )
  return {
    req: {
      scope: {
        resolve: (key: string) => {
          if (key === HAWALA_LEDGER_MODULE) return { listPatronageAllocations: list }
          throw new Error(`unresolvable: ${key}`)
        },
      },
    } as any,
    list,
  }
}

beforeEach(() => {
  ;(resolveVendorSellerId as jest.Mock).mockReset()
  ;(resolveVendorSellerId as jest.Mock).mockResolvedValue("sel_1")
})

describe("GET /vendor/hawala/patronage", () => {
  it("returns the vendor's allocations, newest period first", async () => {
    const { req } = makeReq([
      row({ id: "a", period_key: "2026-Q1" }),
      row({ id: "b", period_key: "2026-Q3" }),
      row({ id: "c", period_key: "2026-Q2" }),
    ])
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.allocations.map((a: any) => a.period_key)).toEqual([
      "2026-Q3",
      "2026-Q2",
      "2026-Q1",
    ])
    expect(res.body.count).toBe(3)
  })

  it("scopes the query to the resolved seller, never another vendor", async () => {
    const { req, list } = makeReq([row({ seller_id: "sel_1" }), row({ id: "x", seller_id: "sel_2" })])
    const res = createRes()

    await GET(req, res)

    expect(list).toHaveBeenCalledWith({ seller_id: "sel_1" })
    expect(res.body.count).toBe(1)
  })

  it("resolves the seller id through seller-context, not auth_context", async () => {
    // This surface rewrites the actor id to `mem_*` while money accrues under
    // `sel_*` — see ../../seller-context.ts.
    const { req } = makeReq([])
    await GET(req, createRes())
    expect(resolveVendorSellerId).toHaveBeenCalledWith(req)
  })

  it("401s when no seller resolves", async () => {
    ;(resolveVendorSellerId as jest.Mock).mockResolvedValue(undefined)
    const { req, list } = makeReq([row()])
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(401)
    expect(list).not.toHaveBeenCalled()
  })

  it("counts only paid allocations as returned surplus", async () => {
    // A queued allocation is an operator decision, not money in a pocket.
    const { req } = makeReq([
      row({ id: "a", status: "paid", allocation_amount: 40 }),
      row({ id: "b", status: "queued", allocation_amount: 500 }),
      row({ id: "c", status: "computed", allocation_amount: 500 }),
    ])
    const res = createRes()

    await GET(req, res)

    expect(res.body.lifetime_paid).toBe(40)
  })

  it("describes patronage as a share of trade, not of investment", async () => {
    const { req } = makeReq([])
    const res = createRes()
    await GET(req, res)
    expect(res.body.explanation).toMatch(/commission you paid/i)
    expect(res.body.explanation).toMatch(/not to any investment/i)
  })

  it("returns an empty, explained result for a vendor with no allocations", async () => {
    const { req } = makeReq([])
    const res = createRes()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.allocations).toEqual([])
    expect(res.body.lifetime_paid).toBe(0)
  })
})
