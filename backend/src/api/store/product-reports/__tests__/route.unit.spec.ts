import { POST, REPORT_REQUEST_TYPE } from "../route"
import { REQUEST_MODULE } from "../../../../modules/request"

/**
 * Intake for a listing report.
 *
 * `ReportListingForm` had no backend at all: its submit handler logged to the
 * browser console, then the UI told the reporter their report would be acted
 * on. These tests pin the properties that make that not happen again — the
 * report is persisted, and a rejected report is rejected rather than silently
 * accepted.
 */

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

function makeReq(body: unknown, opts: { actorId?: string } = {}) {
  const created: Record<string, unknown>[] = []
  const requestService = {
    created,
    createRequest: jest.fn(async (data: Record<string, unknown>) => {
      created.push(data)
      return { id: `req_${created.length}`, status: "pending" }
    }),
  }
  const req = {
    body,
    auth_context: opts.actorId ? { actor_id: opts.actorId } : undefined,
    scope: {
      resolve: (key: string) => {
        if (key === REQUEST_MODULE) return requestService
        throw new Error(`unexpected resolve: ${key}`)
      },
    },
  }
  return { req, requestService }
}

const validBody = {
  product_id: "prod_1",
  reason: "trademark_copyright_dmca",
  comment: "This listing uses artwork I hold the copyright to.",
}

describe("POST /store/product-reports", () => {
  it("persists the report as a request the admin queue already works", async () => {
    const { req, requestService } = makeReq(validBody)
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(requestService.createRequest).toHaveBeenCalledTimes(1)
    expect(requestService.created[0]).toMatchObject({
      type: REPORT_REQUEST_TYPE,
      data: expect.objectContaining({
        product_id: "prod_1",
        reason: "trademark_copyright_dmca",
      }),
    })
  })

  it("accepts a report from a visitor with no session", async () => {
    // A DMCA notice routinely comes from a rights-holder who has never bought
    // anything here. Requiring a customer would discard exactly those.
    const { req, requestService } = makeReq(validBody)
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(requestService.created[0]).toMatchObject({ requester_id: undefined })
  })

  it("records the customer when one is signed in", async () => {
    const { req, requestService } = makeReq(validBody, { actorId: "cus_7" })
    const res = createRes()

    await POST(req as never, res as never)

    expect(requestService.created[0]).toMatchObject({ requester_id: "cus_7" })
  })

  it("carries the reporter's email through, since a DMCA notice needs a contact", async () => {
    const { req, requestService } = makeReq({
      ...validBody,
      reporter_email: "rights@example.com",
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(
      (requestService.created[0].data as Record<string, unknown>).reporter_email
    ).toBe("rights@example.com")
  })

  it("rejects an unknown reason rather than storing an unactionable report", async () => {
    const { req, requestService } = makeReq({ ...validBody, reason: "because" })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(requestService.createRequest).not.toHaveBeenCalled()
  })

  it("rejects a comment too short to act on", async () => {
    const { req, requestService } = makeReq({ ...validBody, comment: "bad" })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(requestService.createRequest).not.toHaveBeenCalled()
  })

  it("rejects a report naming no product", async () => {
    const { req, requestService } = makeReq({
      reason: "counterfeit",
      comment: "This is a replica of a branded item.",
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(requestService.createRequest).not.toHaveBeenCalled()
  })
})
