import { POST as createHarvest } from "../farm/harvests/route"
import { GET as getProvenance } from "../../store/products/[id]/provenance/route"

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

describe("farm + storefront provenance flow", () => {
  it("rejects inconsistent harvest creation for seller farm profile", async () => {
    const req: any = {
      body: {
        crop_name: "Tomato",
        year: 2020,
        harvest_date: "2020-08-01",
      },
      auth_context: { actor_id: "seller_1" },
      scope: {
        resolve: (key: string) => {
          if (key === "query") {
            return {
              graph: async ({ entity }: { entity: string }) => {
                if (entity === "producer_seller") return { data: [{ producer_id: "prod_1" }] }
                if (entity === "producer") return { data: [{ id: "prod_1", year_established: 2022 }] }
                return { data: [] }
              },
            }
          }
          if (key === "agriculture") return { createHarvests: jest.fn() }
          if (key === "link") return { create: jest.fn() }
          return {}
        },
      },
    }

    const res = createRes()
    await createHarvest(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.consistency_issues[0].code).toBe("HARVEST_YEAR_BEFORE_FARM_ESTABLISHED")
  })

  it("returns consistency issues in storefront provenance payload", async () => {
    const req: any = {
      params: { id: "prod_123" },
      scope: {
        resolve: () => ({
          graph: async ({ entity }: { entity: string }) => {
            if (entity === "product") {
              return { data: [{ id: "prod_123", seller: { id: "seller_1", name: "Farm" } }] }
            }
            if (entity === "producer_seller") {
              return { data: [{ producer_id: "producer_1" }] }
            }
            if (entity === "producer") {
              return {
                data: [{
                  id: "producer_1",
                  name: "Farm",
                  handle: "farm",
                  region: "R",
                  state: "S",
                  practices: [],
                  certifications: [],
                  story: "story",
                  photo: null,
                  year_established: 2022,
                  verified: true,
                }],
              }
            }
            if (entity === "availability_window_product") return { data: [] }
            if (entity === "harvest") {
              return {
                data: [{
                  id: "harv_1",
                  crop_name: "Tomato",
                  variety: "Roma",
                  harvest_date: "2021-08-01",
                  growing_method: "Organic",
                  farmer_notes: null,
                  taste_notes: null,
                  season: "SUMMER",
                  year: 2021,
                  photo: null,
                }],
              }
            }
            return { data: [] }
          },
        }),
      },
    }

    const res = createRes()
    await getProvenance(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.provenance.consistency_issues[0].code).toBe("HARVEST_YEAR_BEFORE_FARM_ESTABLISHED")
  })
})
