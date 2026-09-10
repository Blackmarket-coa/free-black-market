/**
 * Verified Blackstar events that write no shipment status.
 *
 * Blackstar emits seven event types; this receiver maps five onto a status.
 * The other two — `shipment.leg.updated` and `shipment.leg.handoff_proof` —
 * report relay progress, and the contract is explicit that no receiver may
 * derive a listing status from them (a leg reaching `completed` says nothing
 * about the shipment when four legs remain).
 *
 * They used to be answered 202 `ignored` and then dropped entirely: no
 * receipt, no record, nothing. The receipt model documented an `ignored`
 * outcome that nothing could reach. From FBM, a relay that was arriving and
 * being deliberately skipped was indistinguishable from a relay that was not
 * arriving at all — which is exactly the reading TRANSMUTATION_NOTES arrived
 * at in the Blackstar repo.
 *
 * `src/api/v1/integrations/**` is on the TS-3 enforcement ratchet, so this
 * file stays free of `any`: route arguments are narrowed with `as never`.
 */
import { POST } from "../route"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../../../../../modules/blackstar-fulfillment"

jest.mock("../../../../../../modules/blackstar-fulfillment/resolve-verification-secret", () => ({
  resolveBlackstarVerificationSecret: jest.fn(async () => ({
    ok: true,
    secret: "s3cret",
    credentialId: null,
  })),
}))

jest.mock("../../../../../../modules/blackstar-fulfillment/verify-blackstar-signature", () => {
  const actual = jest.requireActual(
    "../../../../../../modules/blackstar-fulfillment/verify-blackstar-signature"
  )
  return {
    ...actual,
    verifyBlackstarSignature: jest.fn(() => ({ ok: true })),
  }
})

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

const makeService = () => ({
  recordUnappliedEvent: jest.fn(async () => ({ recorded: true })),
  applyBlackstarEvent: jest.fn(async () => ({
    processed: true,
    decision: { apply: true, reason: "applied" },
    shipment_id: "bs_1",
    resulting_status: "delivered",
  })),
  findActiveBridgeSecret: jest.fn(async () => null),
  touchBridgeCredential: jest.fn(async () => undefined),
})

const makeReq = (service: ReturnType<typeof makeService>, body: unknown) => ({
  headers: {},
  body,
  scope: {
    resolve: (key: string) => {
      if (key === BLACKSTAR_FULFILLMENT_MODULE) return service
      throw new Error(`unresolvable: ${String(key)}`)
    },
  },
})

const LEG_EVENT = {
  event_id: "evt_leg_1",
  event_type: "shipment.leg.updated",
  correlation_id: "corr_1",
  payload: {
    shipment_listing_id: "sbl_1",
    source_order_ref: "order_1",
    shipment_leg_id: "leg_1",
    sequence: 2,
    status: "handed_off",
  },
}

beforeEach(() => {
  process.env.FBM_BLACKSTAR_INTEGRATION = "1"
  process.env.BLACKSTAR_OUTBOUND_SECRET = "s3cret"
})

describe("blackstar events receiver — events that write no status", () => {
  it("records a relay event instead of dropping it", async () => {
    const service = makeService()
    const res = createRes()

    await POST(makeReq(service, LEG_EVENT) as never, res as never)

    expect(res.statusCode).toBe(202)
    expect(service.recordUnappliedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: "evt_leg_1",
        event_type: "shipment.leg.updated",
        source_order_ref: "order_1",
        correlation_id: "corr_1",
        documented: true,
      })
    )
  })

  it("carries the leg identifiers onto the receipt", async () => {
    // Without these the receipt says an event arrived but not which leg it
    // was about, which is most of the value of recording it.
    const service = makeService()
    await POST(makeReq(service, LEG_EVENT) as never, createRes() as never)

    expect(service.recordUnappliedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          shipment_listing_id: "sbl_1",
          shipment_leg_id: "leg_1",
          sequence: 2,
          leg_status: "handed_off",
        }),
      })
    )
  })

  it("separates a documented relay event from a type it has never heard of", async () => {
    const service = makeService()
    const res = createRes()

    await POST(
      makeReq(service, {
        event_id: "evt_x",
        event_type: "shipment.teleported",
        payload: { source_order_ref: "order_1" },
      }) as never,
      res as never
    )

    expect(res.body.reason).toBe("unknown_event_type")
    expect(service.recordUnappliedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ documented: false })
    )
  })

  it("keeps answering 202 ignored, so Blackstar's handling is unchanged", async () => {
    // `reason` is additive. Changing `status` would be a contract break for a
    // sender that switches on it.
    const res = createRes()
    await POST(makeReq(makeService(), LEG_EVENT) as never, res as never)

    expect(res.statusCode).toBe(202)
    expect(res.body.status).toBe("ignored")
    expect(res.body.reason).toBe("no_status_change")
  })

  it("never writes a shipment status for a leg event", async () => {
    // The whole reason these are not in STATUS_FOR_BLACKSTAR_EVENT: a leg
    // reaching `completed` says nothing about a shipment with legs to go.
    const service = makeService()
    await POST(makeReq(service, LEG_EVENT) as never, createRes() as never)

    expect(service.applyBlackstarEvent).not.toHaveBeenCalled()
  })

  it("still answers 202 when recording the receipt fails", async () => {
    // Bookkeeping must not fail an event the sender got right; a 5xx here
    // would make Blackstar retry a delivery that was already correct.
    const service = makeService()
    service.recordUnappliedEvent.mockRejectedValueOnce(new Error("db down"))
    const res = createRes()

    await POST(makeReq(service, LEG_EVENT) as never, res as never)

    expect(res.statusCode).toBe(202)
    expect(res.body.status).toBe("ignored")
  })

  it("leaves a status-bearing event on the applying path", async () => {
    const service = makeService()
    const res = createRes()

    await POST(
      makeReq(service, {
        event_id: "evt_d",
        event_type: "shipment.delivered",
        payload: { source_order_ref: "order_1", status: "delivered" },
      }) as never,
      res as never
    )

    expect(service.applyBlackstarEvent).toHaveBeenCalled()
    expect(service.recordUnappliedEvent).not.toHaveBeenCalled()
    expect(res.body.status).toBe("processed")
  })
})
