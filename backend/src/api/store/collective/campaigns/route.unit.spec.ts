import { POST } from "./route"

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

describe("store collective campaigns route", () => {
  it("returns 401 for unauthenticated POST", async () => {
    const req: any = {
      body: {},
      scope: { resolve: jest.fn() },
    }
    const res = createRes()

    await POST(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe("Unauthorized")
  })

  it("delegates to createCampaignWithMaterialLineItems on valid payload", async () => {
    const service = {
      createCampaignWithMaterialLineItems: jest.fn().mockResolvedValue({ id: "cc_1" }),
    }

    const req: any = {
      auth_context: { actor_id: "vendor_1" },
      body: {
        name: "Campaign",
        description: "desc",
        campaign_type: "PRODUCTION_RUN",
        maker_fee: 10,
        material_line_items: [
          {
            item_name: "cotton",
            supplier_url: "https://supplier.example/cotton",
            unit_cost_at_listing: 5,
            quantity_per_full_campaign: 10,
          },
        ],
      },
      scope: { resolve: () => service },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(201)
    expect(service.createCampaignWithMaterialLineItems).toHaveBeenCalled()
    expect(res.body.campaign).toEqual({ id: "cc_1" })
  })
})
