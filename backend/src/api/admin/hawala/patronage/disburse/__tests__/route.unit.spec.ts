import { POST } from "../route"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  PATRONAGE_DISBURSEMENT_FLAG,
} from "../../../../../../modules/hawala-ledger/patronage-disburse"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"

/**
 * The disburse endpoint's own behaviour: what it refuses, what it defaults to,
 * and the order it does things in.
 *
 * The ordering test is the one that matters. Marking a row paid before the
 * processor confirms would record money that never left.
 */

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

/** Typed reader for the array fields these assertions index into. */
const rows = (body: Record<string, unknown>, key: string): Array<Record<string, unknown>> =>
  (body[key] ?? []) as Array<Record<string, unknown>>

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

const ROW = {
  id: "pa_1",
  seller_id: "sel_1",
  period_key: "2026-Q2",
  gross_volume: 1000,
  allocation_amount: 25,
  allocation_currency: "usd",
  status: "queued",
}

const ACCOUNT = {
  seller_id: "sel_1",
  provider: "stripe_connect",
  external_account_id: "acct_123",
  status: "active",
}

const makeReq = (opts: {
  rows?: Array<Record<string, unknown>>
  accounts?: Array<Record<string, unknown>>
  port?: unknown
  update?: jest.Mock
  accountsThrow?: boolean
  body?: Record<string, unknown>
}) => ({
  body: opts.body ?? { period_key: "2026-Q2" },
  scope: {
    resolve: (key: string) => {
      if (key === HAWALA_LEDGER_MODULE) {
        return {
          listPatronageAllocations: jest.fn(async () => opts.rows ?? [ROW]),
          updatePatronageAllocations: opts.update ?? jest.fn(async () => ({})),
        }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async () => {
            if (opts.accountsThrow) throw new Error("db down")
            return { data: opts.accounts ?? [ACCOUNT] }
          },
        }
      }
      if (key === "patronageDisbursementPort") {
        if (!opts.port) throw new Error("not registered")
        return opts.port
      }
      throw new Error(`unresolvable: ${key}`)
    },
  },
})

const withFlag = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[PATRONAGE_DISBURSEMENT_FLAG]
  if (value === undefined) delete process.env[PATRONAGE_DISBURSEMENT_FLAG]
  else process.env[PATRONAGE_DISBURSEMENT_FLAG] = value
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env[PATRONAGE_DISBURSEMENT_FLAG]
    else process.env[PATRONAGE_DISBURSEMENT_FLAG] = prev
  }
}

describe("POST /admin/hawala/patronage/disburse", () => {
  it("requires a period_key", async () => {
    const res = createRes()
    await POST(makeReq({ body: {} }) as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("409s when nothing is queued", async () => {
    const res = createRes()
    await POST(
      makeReq({ rows: [{ ...ROW, status: "computed" }] }) as never,
      res as never
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.message).toMatch(/Approve the period first/i)
  })

  it("dry-runs by default and moves nothing", async () => {
    await withFlag(undefined, async () => {
      const update = jest.fn(async () => ({}))
      const send = jest.fn()
      const res = createRes()

      await POST(makeReq({ update, port: { send } }) as never, res as never)

      expect(res.body.dry_run).toBe(true)
      expect(res.body.would_pay).toHaveLength(1)
      expect(res.body.total_payable).toBe(25)
      expect(send).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })
  })

  it("names why each seller cannot be paid, in the dry run", async () => {
    await withFlag(undefined, async () => {
      const res = createRes()
      await POST(
        makeReq({ accounts: [{ ...ACCOUNT, status: "restricted" }] }) as never,
        res as never
      )
      expect(res.body.would_pay).toHaveLength(0)
      expect(rows(res.body, "cannot_pay")[0].reason).toMatch(/not active/i)
    })
  })

  it("refuses to mark anything paid when live but no provider is registered", async () => {
    await withFlag("true", async () => {
      const update = jest.fn(async () => ({}))
      const res = createRes()

      await POST(makeReq({ update, port: undefined }) as never, res as never)

      expect(res.statusCode).toBe(503)
      expect(update).not.toHaveBeenCalled()
    })
  })

  it("sends, then marks paid — in that order", async () => {
    await withFlag("true", async () => {
      const calls: string[] = []
      const send = jest.fn(async () => {
        calls.push("send")
        return { reference: "tr_1" }
      })
      const update = jest.fn(async () => {
        calls.push("update")
        return {}
      })
      const res = createRes()

      await POST(makeReq({ update, port: { send } }) as never, res as never)

      expect(calls).toEqual(["send", "update"])
      expect(res.body.paid_count).toBe(1)
      expect(update).toHaveBeenCalledWith({ id: "pa_1", status: "paid" })
    })
  })

  it("passes the deterministic idempotency key to the processor", async () => {
    await withFlag("true", async () => {
      const send = jest.fn(async (payable: { idempotency_key: string }) => ({
        reference: "tr_1",
        payable,
      }))
      const res = createRes()
      await POST(makeReq({ port: { send } }) as never, res as never)

      expect(send.mock.calls[0][0]).toMatchObject({
        idempotency_key: "patronage:2026-Q2:pa_1",
        destination_account_id: "acct_123",
      })
    })
  })

  it("marks failed only when the processor actually rejected", async () => {
    await withFlag("true", async () => {
      const update = jest.fn(async () => ({}))
      const send = jest.fn(async () => {
        throw new Error("card_declined")
      })
      const res = createRes()

      await POST(makeReq({ update, port: { send } }) as never, res as never)

      expect(update).toHaveBeenCalledWith({ id: "pa_1", status: "failed" })
      expect(rows(res.body, "failed")[0].error).toMatch(/card_declined/)
    })
  })

  it("leaves an unpayable row queued rather than failing it", async () => {
    // Refusals are recoverable: fix the account, re-run. `failed` would need
    // a second decision to undo.
    await withFlag("true", async () => {
      const update = jest.fn(async () => ({}))
      const send = jest.fn(async () => ({ reference: "tr_1" }))
      const res = createRes()

      await POST(
        makeReq({
          update,
          port: { send },
          accounts: [{ ...ACCOUNT, provider: "manual" }],
        }) as never,
        res as never
      )

      expect(send).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(res.body.cannot_pay).toHaveLength(1)
    })
  })

  it("reports a payout that landed but whose row would not update", async () => {
    // The one inconsistency the ordering permits, and the retry is safe.
    await withFlag("true", async () => {
      const send = jest.fn(async () => ({ reference: "tr_9" }))
      const update = jest.fn(async () => {
        throw new Error("write conflict")
      })
      const res = createRes()

      await POST(makeReq({ update, port: { send } }) as never, res as never)

      expect(res.body.paid_count).toBe(0)
      expect(rows(res.body, "failed")[0].error).toMatch(/tr_9/)
      expect(rows(res.body, "failed")[0].error).toMatch(/Re-running is safe/i)
    })
  })

  it("fails closed when payout accounts cannot be read", async () => {
    await withFlag("true", async () => {
      const send = jest.fn()
      const res = createRes()

      await POST(
        makeReq({ port: { send }, accountsThrow: true }) as never,
        res as never
      )

      expect(send).not.toHaveBeenCalled()
      expect(rows(res.body, "cannot_pay")[0].reason).toMatch(/no payout account/i)
    })
  })
})
