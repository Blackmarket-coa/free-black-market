import { POST } from "../approve/route"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"

/**
 * The approve endpoint. What matters is that it approves and nothing else:
 * `computed → queued` is a sign-off on the numbers, and no money moves.
 * docs/TRANSMUTATION_STRATEGY.md §5.5.
 */

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

const makeReq = (body: unknown, rows: any[]) => {
  const store = rows.map((r) => ({ ...r }))
  const service = {
    listPatronageAllocations: jest.fn(async (filters: any) =>
      store.filter((r) => !filters?.period_key || r.period_key === filters.period_key)
    ),
    updatePatronageAllocations: jest.fn(async ({ id, status }: any) => {
      const found = store.find((r) => r.id === id)
      if (found) found.status = status
      return found
    }),
  }
  return {
    req: {
      body,
      scope: {
        resolve: (key: string) => {
          if (key === HAWALA_LEDGER_MODULE) return service
          throw new Error(`unresolvable: ${key}`)
        },
      },
    } as any,
    service,
    store,
  }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "pa_1",
  seller_id: "sel_1",
  period_key: "2026-Q2",
  gross_volume: 1000,
  allocation_amount: 50,
  allocation_currency: "USD",
  status: "computed",
  ...over,
})

describe("POST /admin/hawala/patronage/approve", () => {
  it("moves computed allocations to queued", async () => {
    const { req, service, store } = makeReq({ period_key: "2026-Q2" }, [
      row({ id: "a" }),
      row({ id: "b", seller_id: "sel_2" }),
    ])
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.approved_count).toBe(2)
    expect(store.every((r) => r.status === "queued")).toBe(true)
    expect(service.updatePatronageAllocations).toHaveBeenCalledTimes(2)
  })

  it("writes no status other than queued — approving is not paying", async () => {
    const { req, service } = makeReq({ period_key: "2026-Q2" }, [row()])
    await POST(req, createRes())

    for (const call of service.updatePatronageAllocations.mock.calls) {
      expect(call[0].status).toBe("queued")
    }
  })

  it("says plainly that no money moved", async () => {
    const { req } = makeReq({ period_key: "2026-Q2" }, [row()])
    const res = createRes()
    await POST(req, res)
    expect(res.body.note).toMatch(/no money has moved/i)
  })

  it("leaves already-paid allocations alone", async () => {
    const { req, service, store } = makeReq({ period_key: "2026-Q2" }, [
      row({ id: "fresh" }),
      row({ id: "settled", status: "paid" }),
    ])
    await POST(req, createRes())

    const touched = service.updatePatronageAllocations.mock.calls.map((c: any[]) => c[0].id)
    expect(touched).toEqual(["fresh"])
    expect(store.find((r) => r.id === "settled")!.status).toBe("paid")
  })

  it("409s on a period with nothing left to approve", async () => {
    const { req, service } = makeReq({ period_key: "2026-Q2" }, [row({ status: "queued" })])
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(409)
    expect(service.updatePatronageAllocations).not.toHaveBeenCalled()
  })

  it("409s on a period that was never computed", async () => {
    const { req } = makeReq({ period_key: "2026-Q9" }, [])
    const res = createRes()
    await POST(req, res)
    expect(res.statusCode).toBe(409)
  })

  it("400s without a period_key rather than approving everything", async () => {
    const { req, service } = makeReq({}, [row()])
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(service.updatePatronageAllocations).not.toHaveBeenCalled()
  })

  it("touches only the named period", async () => {
    const { req, store } = makeReq({ period_key: "2026-Q2" }, [
      row({ id: "q2" }),
      row({ id: "q1", period_key: "2026-Q1" }),
    ])
    await POST(req, createRes())

    expect(store.find((r) => r.id === "q2")!.status).toBe("queued")
    expect(store.find((r) => r.id === "q1")!.status).toBe("computed")
  })

  it("reports a row that failed without stranding the rest", async () => {
    const { req } = makeReq({ period_key: "2026-Q2" }, [row({ id: "a" }), row({ id: "b" })])
    const service = req.scope.resolve(HAWALA_LEDGER_MODULE)
    const original = service.updatePatronageAllocations
    service.updatePatronageAllocations = jest.fn(async (args: any) => {
      if (args.id === "a") throw new Error("db went away")
      return original(args)
    })
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.approved_count).toBe(1)
    expect(res.body.failed).toEqual([{ id: "a", error: "db went away" }])
  })
})
