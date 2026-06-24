import { GET, PATCH, POST } from "../invoices/route"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../modules/seller-extension/metadata-service"

jest.mock("../../../modules/seller-extension/metadata-service", () => ({
  createSellerMetadataRecord: jest.fn(),
  updateSellerMetadataRecord: jest.fn(),
}))

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

describe("vendor invoices route", () => {
  it("supports create -> list -> patch lifecycle in seller metadata store", async () => {
    const metadataStore: { id: string; metadata: Record<string, unknown> }[] = []

    ;(createSellerMetadataRecord as jest.Mock).mockImplementation(async (_module, input) => {
      const first = input[0]
      metadataStore[0] = { id: "meta_1", metadata: first.metadata }
      return metadataStore
    })

    ;(updateSellerMetadataRecord as jest.Mock).mockImplementation(async (_module, input) => {
      const first = input[0]
      metadataStore[0] = { id: first.id, metadata: first.metadata }
      return metadataStore
    })

    const makeReq = (body: Record<string, unknown> = {}) => ({
      body,
      auth_context: { actor_id: "seller_123" },
      scope: {
        resolve: (key: string) => {
          if (key === "query") {
            return {
              graph: async () => ({ data: metadataStore.length ? [metadataStore[0]] : [] }),
            }
          }
          if (key === "sellerExtension") {
            return {}
          }
          return {}
        },
      },
    })

    const createResObj = createRes()
    await POST(
      makeReq({ order_id: "ord_1", total: 4500, currency_code: "USD", status: "draft" }) as any,
      createResObj as any
    )

    expect(createResObj.statusCode).toBe(201)
    expect(createResObj.body.invoice.status).toBe("draft")

    const listResObj = createRes()
    await GET(makeReq() as any, listResObj as any)
    expect(listResObj.statusCode).toBe(200)
    expect(listResObj.body.invoices).toHaveLength(1)

    const invoiceId = listResObj.body.invoices[0].id
    const patchResObj = createRes()
    await PATCH(makeReq({ id: invoiceId, status: "sent" }) as any, patchResObj as any)

    expect(patchResObj.statusCode).toBe(200)
    expect(patchResObj.body.invoice.status).toBe("sent")
  })
})
