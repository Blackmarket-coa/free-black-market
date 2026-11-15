import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { POST, SELLER_REPORT_REQUEST_TYPE } from "../route"
import { REQUEST_MODULE } from "../../../../modules/request"
import RequestModuleService from "../../../../modules/request/service"
import { ANONYMOUS_SUBMITTER_ID } from "../../../../modules/request/validators"

/**
 * Intake for a report against a seller.
 *
 * `ReportSellerForm`, on every seller page, logged the report to the browser
 * console and then told the reporter it would be acted on. These tests pin
 * what replaces that: a report against a real seller is persisted as a
 * `seller_report` request, and anything else is refused rather than stored.
 *
 * `createRequest` here is the module's real method, bound to a stub of the
 * generated `createRequests` underneath it. Stubbing `createRequest` itself
 * would hide its refusal of a request with no submitter, which is exactly what
 * an anonymous report is.
 */

type Row = Record<string, unknown> & { data: Record<string, unknown> }

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

const SELLERS = [{ id: "sel_real", handle: "real-seller" }]

function makeReq(body: unknown, opts: { actorId?: string } = {}) {
  const rows: Row[] = []
  const createRequests = jest.fn(async (input: Row[]) =>
    input.map((r) => {
      const row = { ...r, id: `req_${rows.length + 1}` }
      rows.push(row)
      return row
    })
  )
  const requestService = { createRequests } as unknown as RequestModuleService
  requestService.createRequest = RequestModuleService.prototype.createRequest.bind(
    requestService
  )

  const graph = jest.fn(
    async ({ entity, filters }: { entity: string; filters: { id?: string } }) => {
      if (entity !== "seller") throw new Error(`unexpected entity: ${entity}`)
      return { data: SELLERS.filter((s) => s.id === filters.id) }
    }
  )

  const req = {
    body,
    auth_context: opts.actorId ? { actor_id: opts.actorId } : undefined,
    scope: {
      resolve: (key: string) => {
        if (key === REQUEST_MODULE) return requestService
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected resolve: ${key}`)
      },
    },
  }
  return { req, rows, createRequests, graph }
}

const validBody = {
  seller_id: "sel_real",
  reason: "trademark_copyright_dmca",
  comment: "This shop sells prints of artwork I hold the copyright to.",
}

describe("POST /store/seller-reports", () => {
  it("files a report from a visitor with no session as a seller_report against the seller", async () => {
    const { req, rows, graph } = makeReq(validBody)
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ id: "req_1", status: "pending" })
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "seller", filters: { id: "sel_real" } })
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: SELLER_REPORT_REQUEST_TYPE,
      status: "pending",
      submitter_id: ANONYMOUS_SUBMITTER_ID,
      requester_id: undefined,
      data: {
        seller_id: "sel_real",
        seller_handle: "real-seller",
        reason: "trademark_copyright_dmca",
        comment: validBody.comment,
        reporter_email: null,
        source: "storefront",
      },
    })
  })

  it("records the customer when the framework resolved one", async () => {
    const { req, rows } = makeReq(validBody, { actorId: "cus_7" })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(rows[0]).toMatchObject({ submitter_id: "cus_7", requester_id: "cus_7" })
  })

  it("carries the reporter's email through, since a DMCA notice needs a contact", async () => {
    const { req, rows } = makeReq({ ...validBody, reporter_email: " rights@example.com " })
    const res = createRes()

    await POST(req as never, res as never)

    expect(rows[0].data.reporter_email).toBe("rights@example.com")
  })

  it("refuses a report naming a seller that does not exist, and stores nothing", async () => {
    const { req, createRequests } = makeReq({ ...validBody, seller_id: "sel_ghost" })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(createRequests).not.toHaveBeenCalled()
  })

  it.each([
    ["names no seller", { reason: validBody.reason, comment: validBody.comment }],
    ["gives an unknown reason", { ...validBody, reason: "because" }],
    ["has a comment too short to act on", { ...validBody, comment: "bad" }],
    ["gives a malformed email", { ...validBody, reporter_email: "not-an-email" }],
    // Strict: a listing report's body sent here is a client bug, not a report.
    ["carries a field the schema does not know", { ...validBody, product_id: "prod_1" }],
    ["is not an object", "seller_id=sel_real"],
  ])("refuses a body that %s, and stores nothing", async (_label, body) => {
    const { req, createRequests, graph } = makeReq(body)
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ type: "invalid_request" })
    expect(graph).not.toHaveBeenCalled()
    expect(createRequests).not.toHaveBeenCalled()
  })
})
